export interface ExternalServiceView {
  binding: {key:string;rigName:string;logicalId:string;host:string;timer:string;service:string;expectedAttachment:"external_cli"};
  availability: "current" | "stale" | "unavailable";
  reason: string | null;
  observedAt: number | null;
  lastAttemptAt: number | null;
  facts: {timer:Record<string,string|number>;service:Record<string,string|number>} | null;
}

export function serviceSummary(v: ExternalServiceView): string {
  if (v.availability !== "current") return v.availability === "stale" ? "Stale" : "Unavailable";
  const t = v.facts?.timer, s = v.facts?.service;
  if (s?.ActiveState === "activating" || (s?.ActiveState === "active" && s.SubState === "running")) return "Running";
  if (t?.LoadState !== "loaded") return "Timer unavailable";
  if (t.UnitFileState === "disabled" || t.UnitFileState === "masked") return "Timer disabled";
  return t.ActiveState === "active" ? (t.SubState === "waiting" ? "Scheduled" : `Timer ${t.SubState}`) : "Timer inactive";
}
export function invocationSummary(v: ExternalServiceView): string {
  const s = v.facts?.service;
  if (!s) return "No observation available";
  if (s.ActiveState === "activating" || (s.ActiveState === "active" && s.SubState === "running")) return "Running; previous result unavailable";
  if (!(Number(s.ExecMainStartTimestamp) > 0 && Number(s.ExecMainExitTimestamp) >= Number(s.ExecMainStartTimestamp))) return s.Result !== "success" ? `systemd Result: ${s.Result}; no recorded main-process invocation` : s.ActiveState === "failed" ? "Service failed; no recorded main-process invocation" : "systemd reports no recorded invocation";
  if (s.ExecMainCode === 1) return `exited ${s.ExecMainStatus}${s.Result !== "success" ? `; ${s.Result}` : ""}`;
  if (s.ExecMainCode === 2 || s.ExecMainCode === 3) return `signal ${s.ExecMainStatus}${s.ExecMainCode === 3 ? " (core dumped)" : ""}; ${s.Result}`;
  return `Exit status unavailable; systemd Result: ${s.Result}`;
}
export function resultDisagrees(v: ExternalServiceView): boolean {
  const s = v.facts?.service;
  return !!s && Number(s.ExecMainExitTimestamp) >= Number(s.ExecMainStartTimestamp) && Number(s.ExecMainStartTimestamp) > 0 && s.Result === "success" && ((s.ExecMainCode === 1 && s.ExecMainStatus !== 0) || s.ExecMainCode === 2 || s.ExecMainCode === 3);
}
