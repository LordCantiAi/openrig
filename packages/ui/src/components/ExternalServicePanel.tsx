import { Server } from "lucide-react";
import { Handle, Position } from "@xyflow/react";
import { type ExternalServiceView, serviceSummary, invocationSummary, resultDisagrees } from "../lib/external-service.js";
import { cn } from "../lib/utils.js";
import { NODE_CARD, HYBRID_NODE_CARD, NODE_HEADER, HYBRID_NODE_HEADER, NODE_HEADER_SURFACE, NODE_BODY, NODE_IDENTITY } from "./topology/node-card-styles.js";

export function ExternalServiceBadge({compact=false}:{compact?:boolean}) {
  return <span className={cn("inline-flex items-center gap-1 font-mono text-on-surface-variant", compact ? "text-[8px] leading-tight" : "text-xs")}><Server aria-hidden="true" size={compact ? 10 : 12} />External Service</span>;
}
function Timestamp({value,micro=false}:{value:unknown;micro?:boolean}) {
  const n = typeof value === "number" ? value/(micro ? 1000 : 1) : 0;
  if (!n || !Number.isFinite(n) || !Number.isFinite(new Date(n).getTime())) return <span>Not recorded by systemd</span>;
  const d = new Date(n);
  return <time dateTime={d.toISOString()} title={d.toISOString()}>{new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"long"}).format(d)}</time>;
}
export function ExternalServicePanel({data}:{data:ExternalServiceView}) {
  const t = data.facts?.timer,s = data.facts?.service;
  return <section aria-label="External service telemetry" className="space-y-4 border border-outline-variant bg-surface-lowest/30 p-4">
    <h2 className="text-lg font-semibold">Scheduler status</h2>
    <p role="status" aria-live="polite">{serviceSummary(data)}{data.reason ? ` — ${data.reason}` : ""}</p>
    {data.availability !== "current" && data.facts ? <p role="status">Values below are historical, not a current service-health check.</p> : null}
    <dl className="grid gap-3 sm:grid-cols-2 [&_dt]:text-on-surface-variant [&_dd]:break-words [&_dd]:tabular-nums">
      <div><dt>Observed host</dt><dd>{data.binding.host}</dd></div>
      <div><dt>Timer</dt><dd>{data.binding.timer}</dd></div>
      <div><dt>Timer enabled state</dt><dd>{t?.UnitFileState ?? "Unavailable"}</dd></div>
      <div><dt>Timer state</dt><dd>{t ? `${t.ActiveState} / ${t.SubState}` : "Unavailable"}</dd></div>
      <div><dt>Next scheduled run</dt><dd><Timestamp value={t?.NextElapseUSecRealtime} micro /></dd></div>
      <div><dt>Last timer trigger</dt><dd><Timestamp value={t?.LastTriggerUSec} micro /></dd></div>
      <div><dt>Service</dt><dd>{data.binding.service}</dd></div>
      <div><dt>Service state</dt><dd>{s ? `${s.ActiveState} / ${s.SubState}` : "Unavailable"}{s?.Type === "oneshot" && s.ActiveState === "inactive" ? " — idle between runs" : ""}</dd></div>
      <div><dt>Last invocation</dt><dd>{invocationSummary(data)}</dd></div>
      <div><dt>systemd Result</dt><dd>{s?.Result ?? "Unavailable"}{resultDisagrees(data) ? " (differs from exit status)" : ""}</dd></div>
      <div><dt>Invocation started</dt><dd><Timestamp value={s?.ExecMainStartTimestamp} micro /></dd></div>
      <div><dt>Invocation exited</dt><dd><Timestamp value={s?.ExecMainExitTimestamp} micro /></dd></div>
      <div><dt>Last successful observation</dt><dd>{data.observedAt ? <Timestamp value={data.observedAt} /> : "No successful observation"}</dd></div>
      <div><dt>Last collection attempt</dt><dd>{data.lastAttemptAt ? <Timestamp value={data.lastAttemptAt} /> : "Unavailable"}</dd></div>
    </dl>
    <p className="text-sm text-on-surface-variant">Read-only host observations. An inactive oneshot is normal between scheduled runs. Process results do not establish Cascade workflow completion or trade outcome.</p>
  </section>;
}
export function ExternalServiceNode({data,label,identity,horizontal=false}:{data:ExternalServiceView;label:string;identity:string;horizontal?:boolean}) {
  const summary = [serviceSummary(data), data.availability !== "current" ? data.reason : null].filter(Boolean).join(" — ");
  const invocation = `${data.availability === "current" ? "Last invocation" : "Historical invocation"}: ${invocationSummary(data)}`;
  return <div className={cn(horizontal ? HYBRID_NODE_CARD : NODE_CARD, "border-on-surface text-on-surface", horizontal ? "min-w-0" : "w-[240px] bg-surface-lowest")} data-testid="external-service-node" title={[label, identity, summary, invocation].join("\n")}>
    <Handle type="target" position={horizontal ? Position.Left : Position.Top} className={horizontal ? "opacity-0" : undefined} />
    <div className={cn(horizontal ? HYBRID_NODE_HEADER : NODE_HEADER, NODE_HEADER_SURFACE)}>
      <span className="min-w-0 truncate font-bold" title={label}>{label}</span>
    </div>
    <div className={NODE_BODY}>
      <div className={NODE_IDENTITY} title={identity}>{identity}</div>
      <div className="min-w-0 leading-none"><ExternalServiceBadge compact /></div>
      <div className="truncate font-mono text-[8px] leading-tight" title={summary}>{summary}</div>
      <div className="truncate font-mono text-[8px] leading-tight text-on-surface-variant" title={invocation}>{invocation}</div>
    </div>
    <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} className={horizontal ? "opacity-0" : undefined} />
  </div>;
}
