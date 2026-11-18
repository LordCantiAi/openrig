import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";
import { getNodeInventory } from "../src/domain/node-inventory.js";
import { projectRigToGraph } from "../src/domain/graph-projection.js";
import { PodRepository } from "../src/domain/pod-repository.js";

describe("member display labels through the operator route and projections", () => {
  let db: Database.Database;
  let setup: ReturnType<typeof createTestApp>;
  beforeEach(() => { db = createFullTestDb(); setup = createTestApp(db); });
  afterEach(() => db.close());

  function seed(runtime = "codex", member = "lead") {
    const rig = setup.rigRepo.findRigsByName("label-team")[0] ?? setup.rigRepo.createRig("label-team");
    const pods = new PodRepository(db);
    const pod = pods.getPodByNamespace(rig.id, "dev") ?? pods.createPod(rig.id, "dev", "Development");
    const node = setup.rigRepo.addNode(rig.id, `dev.${member}`, {
      runtime, podId: pod.id, agentRef: "local:agents/worker", profile: "default", cwd: "." });
    const session = setup.sessionRegistry.registerSession(node.id, `dev-${member}@label-team`);
    setup.sessionRegistry.updateBinding(node.id, runtime === "external_cli"
      ? { attachmentType: "external_cli" }
      : { attachmentType: "tmux", tmuxSession: session.sessionName, tmuxWindow: "@1", tmuxPane: "%1" });
    return { rig, node, session };
  }

  async function set(ref: string, body: Record<string, unknown>) {
    return setup.app.request(`/api/seat/set-label/${encodeURIComponent(ref)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Explain the responsibility", operator: "operator@external", ...body }) });
  }

  it.each(["codex", "external_cli"])("sets and clears %s metadata without changing its binding or siblings", async runtime => {
    const { rig, node } = seed(runtime);
    const sibling = seed("codex", "peer").node;
    const before = setup.rigRepo.getRig(rig.id)!;
    const sessions = db.prepare("SELECT * FROM sessions ORDER BY id").all();
    const label = "Research Lead (Due Diligence) — 分析 <b>literal</b>";
    const response = await set(`dev.lead@label-team`, { label: ` ${label} ` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, from: null, to: label, changed: true });
    const after = setup.rigRepo.getRig(rig.id)!;
    const updated = after.nodes.find(n => n.id === node.id)!;
    expect(updated).toEqual({ ...before.nodes.find(n => n.id === node.id), label });
    expect(after.nodes.find(n => n.id === sibling.id)).toEqual(before.nodes.find(n => n.id === sibling.id));
    expect(after.edges).toEqual(before.edges);
    expect(db.prepare("SELECT * FROM sessions ORDER BY id").all()).toEqual(sessions);
    expect(getNodeInventory(db, rig.id).find(n => n.nodeId === node.id)).toMatchObject({ label, runtime });
    const graph = projectRigToGraph({ ...after, sessions: [] });
    expect(graph.nodes.find(n => n.id === node.id)?.data).toMatchObject({ label, logicalId: "dev.lead", runtime });
    const snapshot = setup.snapshotCapture.captureSnapshot(rig.id, "manual");
    expect(snapshot.data.nodes.find(n => n.id === node.id)?.label).toBe(label);
    const exported = setup.rigSpecExporter.exportRig(rig.id);
    expect("pods" in exported && exported.pods[0]?.members.find(m => m.id === "lead")?.label).toBe(label);
    const repeat = await set("dev.lead@label-team", { label });
    expect(await repeat.json()).toMatchObject({ changed: false });
    expect(db.prepare("SELECT COUNT(*) as n FROM events WHERE type='node.label_changed'").get()).toEqual({ n: 1 });
    const audit = db.prepare("SELECT payload FROM events WHERE type='node.label_changed'").get() as { payload: string };
    expect(JSON.parse(audit.payload)).toMatchObject({ operator: "operator@external", from: null, to: label, reason: "Explain the responsibility" });
    expect((await set("dev.lead@label-team", { clear: true })).status).toBe(200);
    expect(getNodeInventory(db, rig.id).find(n => n.nodeId === node.id)?.label).toBeNull();
  });

  it("keeps duplicate labels out of seat resolution and supports exact node-ID updates", async () => {
    const { rig, node } = seed();
    const peer = seed("external_cli", "peer").node;
    await set("dev.lead@label-team", { label: "Same (Role)" });
    await set("dev.peer@label-team", { label: "Same (Role)" });
    expect((await set("Same (Role)", { label: "Wrong" })).status).toBe(404);
    expect((await set(`node/${node.id}`, { label: "Exact (Role)" })).status).toBe(404); // slash is an encoded seat ref
    const response = await setup.app.request(`/api/seat/set-label/node/${node.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Exact (Role)", reason: "Precise target", operator: "operator@external" }) });
    expect(response.status).toBe(200);
    const nodes = setup.rigRepo.getRig(rig.id)!.nodes;
    expect(nodes.find(n => n.id === node.id)?.label).toBe("Exact (Role)");
    expect(nodes.find(n => n.id === peer.id)?.label).toBe("Same (Role)");
  });

  it("refuses missing actors, malformed payloads, control characters and oversized labels without writes", async () => {
    const { node } = seed();
    for (const body of [{ label: "Label", operator: "" }, { label: "Label", reason: "" },
      { label: "x", clear: true }, { label: 7 }, { label: null }, { label: "x", clear: "true" },
      { label: "x\ny" }, { label: "x".repeat(201) }]) {
      expect((await set("dev.lead@label-team", body)).status).toBe(400);
    }
    expect((db.prepare("SELECT label FROM nodes WHERE id=?").get(node.id) as { label: null }).label).toBeNull();
    expect(db.prepare("SELECT COUNT(*) as n FROM events WHERE type='node.label_changed'").get()).toEqual({ n: 0 });
    expect((await set("dev.lead@label-team", { label: "   " })).status).toBe(200);
  });

  it("does not select an ambiguous logical ID or an unknown seat", async () => {
    seed();
    const other = setup.rigRepo.createRig("other-team");
    setup.rigRepo.addNode(other.id, "dev.lead", { runtime: "codex" });
    expect((await set("dev.lead", { label: "Wrong" })).status).toBe(409);
    expect((await set("missing", { label: "Wrong" })).status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) as n FROM events WHERE type='node.label_changed'").get()).toEqual({ n: 0 });
  });

  it("normalizes a legacy stored label and refuses unavailable storage without an audit event", async () => {
    const { node } = seed();
    setup.rigRepo.setNodeLabel(node.id, " Legacy (Role) ");
    expect(await (await set("dev.lead@label-team", { label: "Legacy (Role)" })).json()).toMatchObject({
      changed: true, from: " Legacy (Role) ", to: "Legacy (Role)" });
    const before = db.prepare("SELECT COUNT(*) as n FROM events WHERE type='node.label_changed'").get();
    db.exec("ALTER TABLE nodes DROP COLUMN label");
    const response = await set("dev.lead@label-team", { label: "New (Role)" });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, code: "label_unavailable" });
    expect(db.prepare("SELECT COUNT(*) as n FROM events WHERE type='node.label_changed'").get()).toEqual(before);
  });
});
