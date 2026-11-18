import { describe,it,expect } from "vitest";
import { render,screen,cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ExternalServicePanel, ExternalServiceNode } from "../src/components/ExternalServicePanel.js";
import { NODE_CARD, HYBRID_NODE_CARD, NODE_BODY, NODE_IDENTITY, HYBRID_NODE_HEADER } from "../src/components/topology/node-card-styles.js";
import { type ExternalServiceView,serviceSummary,invocationSummary,resultDisagrees } from "../src/lib/external-service.js";
const view=():ExternalServiceView=>({binding:{key:"test",rigName:"test",logicalId:"planning.scheduler",host:"test-host",timer:"test.timer",service:"test.service",expectedAttachment:"external_cli"},availability:"current",reason:null,observedAt:1795000000000,lastAttemptAt:1795000000000,facts:{timer:{LoadState:"loaded",ActiveState:"active",SubState:"waiting",UnitFileState:"enabled",NextElapseUSecRealtime:1795050000000000},service:{Type:"oneshot",ActiveState:"inactive",SubState:"dead",Result:"success",ExecMainCode:1,ExecMainStatus:1,ExecMainStartTimestamp:1794900000000000,ExecMainExitTimestamp:1794900100000000}}});
describe("external service presentation",()=>{
  it.each([false,true])("composes native shell and typography classes (horizontal=%s)",(horizontal)=>{
    const label="Cascade Paper Scheduler (cascade-native-paper.service)";
    const identity="planning-scheduler@cascade";
    render(<ReactFlowProvider><ExternalServiceNode data={view()} label={label} identity={identity} horizontal={horizontal}/></ReactFlowProvider>);
    const card=screen.getByTestId("external-service-node");
    for (const cls of (horizontal ? HYBRID_NODE_CARD : NODE_CARD).split(" ").filter(cls=>!cls.startsWith("min-w-"))) expect(card.classList.contains(cls)).toBe(true);
    expect(card.classList.contains("min-w-[200px]")).toBe(!horizontal);
    expect(card.classList.contains("w-[240px]")).toBe(!horizontal);
    expect(card.classList.contains("p-3")).toBe(false);
    const header=screen.getByText(label);
    expect(header.classList.contains("truncate")).toBe(true);
    expect(header.title).toBe(label);
    if(horizontal) for(const cls of HYBRID_NODE_HEADER.split(" ")) expect(header.parentElement!.classList.contains(cls)).toBe(true);
    for(const cls of NODE_IDENTITY.split(" ")) expect(screen.getByText(identity).classList.contains(cls)).toBe(true);
    for(const cls of NODE_BODY.split(" ")) expect(screen.getByText(identity).parentElement!.classList.contains(cls)).toBe(true);
    expect(screen.getByText("External Service").classList.contains("text-[8px]")).toBe(true);
    expect(screen.getByText("Last invocation: exited 1").classList.contains("truncate")).toBe(true);
    expect(card.querySelectorAll(".react-flow__handle")).toHaveLength(2);
    for(const handle of card.querySelectorAll(".react-flow__handle")) expect(handle.classList.contains("opacity-0")).toBe(horizontal);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("token-total")).toBeNull();
    expect(card.querySelector("[data-activity-state]")).toBeNull();
  });
  it.each(["stale","unavailable"] as const)("keeps %s explicit in the compact card",(availability)=>{
    const data=view();data.availability=availability;data.reason="Observation is not current";
    render(<ReactFlowProvider><ExternalServiceNode data={data} label="Scheduler" identity="scheduler@rig" horizontal/></ReactFlowProvider>);
    expect(screen.getByText(`${availability === "stale" ? "Stale" : "Unavailable"} — Observation is not current`)).toBeTruthy();
    expect(screen.getByText("Historical invocation: exited 1")).toBeTruthy();
  });
  it("shows scheduled idle oneshot and conflicting process result without controls",()=>{
    const v=view();render(<ExternalServicePanel data={v}/>);
    expect(screen.getByText("Scheduled")).toBeTruthy();expect(screen.getByText("exited 1")).toBeTruthy();
    expect(screen.getByText("success (differs from exit status)")).toBeTruthy();expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Process results do not establish/)).toBeTruthy();cleanup();
  });
  it("does not imply success on timeout, signal or absent timestamps",()=>{
    const v=view();v.facts!.service.ExecMainStatus=0;v.facts!.service.Result="timeout";expect(invocationSummary(v)).toBe("exited 0; timeout");
    v.facts!.service.ExecMainCode=2;v.facts!.service.ExecMainStatus=9;expect(invocationSummary(v)).toMatch(/signal 9/);
    v.facts!.service.ExecMainStartTimestamp=0;expect(invocationSummary(v)).toMatch(/no recorded main-process invocation/);expect(invocationSummary(v)).toMatch(/timeout/);
    v.facts!.service.Result="start-limit-hit";expect(invocationSummary(v)).toMatch(/start-limit-hit/);
  });
  it("distinguishes unavailable, stale, disabled and running",()=>{
    const v=view();v.availability="stale";expect(serviceSummary(v)).toBe("Stale");
    render(<ExternalServicePanel data={v}/>);expect(screen.getByText(/Values below are historical/)).toBeTruthy();cleanup();
    v.availability="unavailable";expect(serviceSummary(v)).toBe("Unavailable");
    v.availability="current";v.facts!.timer.UnitFileState="disabled";expect(serviceSummary(v)).toBe("Timer disabled");
    v.facts!.service.ActiveState="activating";expect(serviceSummary(v)).toBe("Running");
  });
  it("renders untrusted strings as text and no contradiction while running",()=>{
    const v=view();v.binding.host="<script>bad</script>";v.facts!.service.ActiveState="activating";
    render(<ExternalServicePanel data={v}/>);expect(document.querySelector("script")).toBeNull();expect(screen.getByText("<script>bad</script>")).toBeTruthy();cleanup();
    v.facts!.service.ExecMainExitTimestamp=0;expect(resultDisagrees(v)).toBe(false);
  });
});
