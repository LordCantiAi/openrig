import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";

export interface ExternalBinding { key: string; rigName: string; logicalId: string; host: string; timer: string; service: string; expectedAttachment: "external_cli" }
export interface ExternalServiceView {
  binding: ExternalBinding;
  availability: "current" | "stale" | "unavailable";
  reason: string | null;
  observedAt: number | null;
  lastAttemptAt: number | null;
  facts: { timer: Record<string, string | number>; service: Record<string, string | number> } | null;
}
const MAX = 65_536;
type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const bounded = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
const timestamp = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const bootPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

// No requests execute host commands. O_NONBLOCK also prevents a FIFO replacing
// the expected file from holding a reader before the regular-file check.
async function json(path: string, rootOwned = false, owner = 0): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX || (rootOwned && (stat.uid !== owner || (stat.mode & 0o022) !== 0))) throw Error("invalid_file");
    const buffer = Buffer.alloc(MAX + 1);
    let used = 0;
    while (used <= MAX) { const { bytesRead } = await file.read(buffer, used, buffer.length - used, null); if (!bytesRead) break; used += bytesRead; }
    if (used > MAX) throw Error("oversized");
    return JSON.parse(buffer.subarray(0, used).toString("utf8"));
  } finally { await file.close(); }
}

export function parseRegistry(v: unknown): ExternalBinding[] {
  if (!object(v) || v.version !== 1 || !Array.isArray(v.services) || v.services.length > 16) throw Error("invalid_registry");
  const keys = new Set<string>(), bindings = new Set<string>();
  return v.services.map((r: unknown) => {
    if (!object(r) || !["key", "rigName", "logicalId", "host", "timer", "service"].every(k => bounded(r[k])) || r.expectedAttachment !== "external_cli") throw Error("invalid_registry");
    if (!/^[A-Za-z0-9_.@-]+\.timer$/.test(r.timer) || !/^[A-Za-z0-9_.@-]+\.service$/.test(r.service)) throw Error("invalid_registry");
    const id = `${r.rigName}\0${r.logicalId}`;
    if (keys.has(r.key) || bindings.has(id)) throw Error("duplicate_registry");
    keys.add(r.key); bindings.add(id);
    return Object.fromEntries(["key","rigName","logicalId","host","timer","service","expectedAttachment"].map(k => [k,r[k]])) as unknown as ExternalBinding;
  });
}

function facts(v: unknown, binding: ExternalBinding): ExternalServiceView["facts"] {
  if (!object(v) || !object(v.timer) || !object(v.service)) throw Error("invalid_facts");
  const t = v.timer, s = v.service;
  for (const row of [t,s]) {
    for (const key of ["LoadState","ActiveState","SubState"]) if (!bounded(row[key])) throw Error("invalid_facts");
    if (typeof row.UnitFileState !== "string" || row.UnitFileState.length > 200 || /[\x00-\x1f\x7f]/.test(row.UnitFileState)) throw Error("invalid_facts");
  }
  if (t.Unit !== binding.service || !timestamp(t.NextElapseUSecRealtime) || !timestamp(t.LastTriggerUSec)) throw Error("invalid_facts");
  if (!bounded(s.Type) || !bounded(s.Result) || typeof s.InvocationID !== "string" || !/^[a-f0-9]{32}$/.test(s.InvocationID)) throw Error("invalid_facts");
  if (!timestamp(s.ExecMainStartTimestamp) || !timestamp(s.ExecMainExitTimestamp) || !Number.isInteger(s.ExecMainCode) || !Number.isInteger(s.ExecMainStatus) || s.ExecMainCode < 0 || s.ExecMainCode > 6 || s.ExecMainStatus < 0 || s.ExecMainStatus > 255) throw Error("invalid_facts");
  if (s.ExecMainExitTimestamp && s.ExecMainExitTimestamp < s.ExecMainStartTimestamp) throw Error("invalid_facts");
  // Explicit projection prevents unreviewed properties leaking through the API.
  const pick = (r: Obj, ks: string[]) => Object.fromEntries(ks.map(k => [k,r[k]]));
  return { timer: pick(t,["LoadState","ActiveState","SubState","UnitFileState","Unit","NextElapseUSecRealtime","LastTriggerUSec"]), service: pick(s,["LoadState","ActiveState","SubState","UnitFileState","Type","Result","InvocationID","ExecMainCode","ExecMainStatus","ExecMainStartTimestamp","ExecMainExitTimestamp"]) };
}

export function projectObservation(binding: ExternalBinding, snapshot: unknown, bootId: string | null, now: number): ExternalServiceView {
  const unavailable = (reason: string): ExternalServiceView => ({ binding,availability:"unavailable",reason,observedAt:null,lastAttemptAt:null,facts:null });
  if (!bootId || !bootPattern.test(bootId)) return unavailable("boot identity unverified");
  if (!object(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > 16) return unavailable("observation unavailable");
  const keys = snapshot.entries.map((e: unknown) => object(e) ? e.key : null);
  if (keys.some((k: unknown) => !bounded(k)) || new Set(keys).size !== keys.length) return unavailable("invalid observation");
  const e = snapshot.entries.find((e: Obj) => e.key === binding.key);
  if (!e) return unavailable("no observation");
  if (!object(e.binding) || Object.keys(binding).some(k => e.binding[k] !== binding[k as keyof ExternalBinding])) return unavailable("binding mismatch");
  if (e.bootId !== bootId) return unavailable("different host boot");
  if (!timestamp(e.lastAttemptAt) || e.lastAttemptAt > now + 30_000 || (e.error !== null && e.error !== "probe_failed")) return unavailable("invalid observation");
  if (e.observedAt === null && e.facts === null && e.error !== null) return { ...unavailable("collection failed"),lastAttemptAt:e.lastAttemptAt };
  if (!timestamp(e.observedAt) || e.observedAt > now + 30_000 || e.observedAt > e.lastAttemptAt) return unavailable("invalid observation time");
  try {
    const parsed = facts(e.facts,binding);
    const stale = now - e.observedAt > 180_000;
    return { binding,availability:stale ? "stale" : e.error ? "unavailable" : "current",reason: e.error ? "collection failed; values are historical" : stale ? "observer sample expired" : null,observedAt:e.observedAt,lastAttemptAt:e.lastAttemptAt,facts:parsed };
  } catch { return unavailable("invalid observation facts"); }
}

const cache = new Map<string,{ until: number; registry: unknown; snapshot: unknown }>();
export async function readExternalServices(db: Database.Database, rigId: string, options: {directory?: string; now?:number; bootId?:string | null; registryOwner?:number} = {}): Promise<ExternalServiceView[]> {
  const directory = options.directory ?? process.env.OPENRIG_EXTERNAL_SERVICES_DIR;
  if (!directory) return [];
  const now = options.now ?? Date.now();
  try {
  const rigs = db.prepare("SELECT id,name,archived_at FROM rigs WHERE id=?").all(rigId) as Array<{id:string;name:string;archived_at:string|null}>;
  if (rigs.length !== 1 || rigs[0]!.archived_at) return [];
  const rig = rigs[0]!;
  if ((db.prepare("SELECT count(*) AS n FROM rigs WHERE name=? AND archived_at IS NULL").get(rig.name) as {n:number}).n !== 1) return [];
    const cacheKey = `${directory}\0${options.registryOwner ?? 0}`;
    let data = cache.get(cacheKey);
    if (!data || data.until < now) {
      data = {until:now+2000,registry:await json(join(directory,"registry.json"),true,options.registryOwner ?? 0),snapshot:await json(join(directory,"status/observations.json")).catch(()=>null)};
      if (cache.size > 32) cache.clear();
      cache.set(cacheKey,data);
    }
    const bindings = parseRegistry(data.registry);
    const bootId = options.bootId !== undefined ? options.bootId : await readFile("/proc/sys/kernel/random/boot_id","utf8").then(s=>s.trim()).catch(()=>null);
    return bindings.filter(b => b.rigName === rig.name).flatMap(binding => {
      const nodes = db.prepare("SELECT n.id FROM nodes n JOIN bindings b ON b.node_id=n.id WHERE n.rig_id=? AND n.logical_id=? AND n.runtime='external_cli' AND b.attachment_type='external_cli'").all(rigId,binding.logicalId);
      if (nodes.length !== 1) return [];
      return [projectObservation(binding,data!.snapshot,bootId,now)];
    });
  } catch { return []; } // Optional telemetry cannot fail native topology or health.
}
