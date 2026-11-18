import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importActual) => ({
  ...await importActual<typeof import("@tanstack/react-router")>(),
  useNavigate: () => navigate,
}));
vi.mock("../src/components/terminal/ProgressiveTerminal.js", () => ({
  ProgressiveTerminal: ({ sessionName }: { sessionName: string }) => <div data-testid="terminal-session">{sessionName}</div>,
}));

import { RigNode } from "../src/components/RigNode.js";
import { HybridAgentNode } from "../src/components/topology/HybridTopologyNodes.js";
import { TopologyTableView } from "../src/components/topology/TopologyTableView.js";
import { TopologyTerminalView } from "../src/components/topology/TopologyTerminalView.js";
import { layoutHybridRig } from "../src/lib/hybrid-layout.js";

const base = {
  rigId: "rig-1", rigName: "test-rig", logicalId: "dev.analyst", podId: "dev",
  canonicalSessionName: "dev-analyst@test-rig", nodeKind: "agent" as const,
  runtime: "claude-code", sessionStatus: "running", startupStatus: "ready" as const,
  status: "running", restoreOutcome: "n-a", tmuxAttachCommand: null, resumeCommand: null,
  latestError: null, role: "worker", model: null, binding: null,
};
const mockFetch = vi.fn();

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><ReactFlowProvider>{children}</ReactFlowProvider></QueryClientProvider>);
}

function inventory(seats: unknown[]) {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/api/rigs/summary")) return new Response(JSON.stringify([{ id: "rig-1", name: "test-rig" }]));
    if (url.includes("/open-cmux")) return new Response(JSON.stringify({ ok: true, action: "created_new" }));
    if (url.includes("/nodes")) return new Response(JSON.stringify(seats));
    return new Response("[]");
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("friendly member labels on composed web surfaces", () => {
  it.each([false,true])("routes registered services through the native card entry point (hybrid=%s)",(hybrid)=>{
    const externalService = {
      binding:{key:"scheduler",rigName:"test-rig",logicalId:"dev.scheduler",host:"fozzy",timer:"test.timer",service:"test.service",expectedAttachment:"external_cli" as const},
      availability:"unavailable" as const,reason:"No observation",observedAt:null,lastAttemptAt:null,facts:null,
    };
    const data={...base,label:"Scheduler".repeat(40),externalService};
    mount(hybrid ? <HybridAgentNode data={data}/> : <RigNode data={data}/>);
    const card=screen.getByTestId("external-service-node");
    expect(card.classList.contains("h-full")).toBe(hybrid);
    expect(screen.getByText(data.label).classList.contains("truncate")).toBe(true);
    expect(screen.getByText("External Service")).toBeDefined();
    expect(screen.queryByTestId(`activity-dot-${base.logicalId}`)).toBeNull();
    expect(card.querySelector("button")).toBeNull();
  });
  it.each([undefined, null, "  ", " Research Analyst (研究) ", "<img src=x onerror=alert(1)>", "Analyst".repeat(80)])("renders graph card labels safely and preserves fallback and identity: %s", (label) => {
    const name = label?.trim() || "analyst";
    const { container } = mount(<RigNode data={{ ...base, label }} />);
    expect(screen.getByTitle(name).textContent).toBe(name);
    expect(screen.getByText(base.canonicalSessionName)).toBeDefined();
    expect(screen.getByTestId("activity-dot-dev.analyst").getAttribute("data-activity-state")).toBe("unknown");
    expect(container.querySelector("img")).toBeNull();
  });

  it("preserves labels through hybrid layout, including external seats and memoized updates", () => {
    const label = "Research Schedule (Systemd Service)";
    const layout = layoutHybridRig({ rigId: "rig-1", nodes: [{ id: "scheduler", type: "rigNode", position: { x: 0, y: 0 }, data: { ...base, logicalId: "dev.scheduler", canonicalSessionName: null, label, runtime: "external" } }], edges: [], collapsed: false });
    const node = layout.nodes.find((n) => n.type === "rigNode")!;
    expect(node.id).toBe("rig-1::scheduler");
    const data = node.data as typeof base & { label: string };
    const { rerender } = mount(<HybridAgentNode data={data} />);
    expect(screen.getByTitle(label).textContent).toBe(label);
    expect(screen.getByText("dev.scheduler")).toBeDefined();
    expect(screen.getByTestId("hybrid-activity-dot-dev.scheduler").getAttribute("data-activity-state")).toBe("unknown");
    // Keep the provider and data identities stable except for the changed label.
    const client = new QueryClient();
    const tree = (label: string) => <QueryClientProvider client={client}><ReactFlowProvider><HybridAgentNode data={{ ...data, label }} /></ReactFlowProvider></QueryClientProvider>;
    rerender(tree(label));
    rerender(tree("Renamed schedule"));
    expect(screen.getByTitle("Renamed schedule")).toBeDefined();
    client.clear();
  });

  it("shows duplicate labels as distinct table rows and targets only machine IDs", async () => {
    const label = "Research Analyst (研究)";
    inventory([{ ...base, label }, { ...base, logicalId: "dev.scheduler", canonicalSessionName: null, label, runtime: "external" }]);
    mount(<TopologyTableView />);
    const row = await screen.findByTestId("topology-table-row-dev.analyst");
    const sibling = screen.getByTestId("topology-table-row-dev.scheduler");
    expect(within(row).getByTitle(label)).toBeDefined();
    expect(within(sibling).getByTitle(label)).toBeDefined();
    expect(within(sibling).getByText("dev.scheduler")).toBeDefined();
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith({ to: "/topology/seat/$rigId/$logicalId", params: { rigId: "rig-1", logicalId: "dev.analyst" } });
    fireEvent.click(screen.getByTestId("topology-table-cmux-dev.scheduler"));
    await waitFor(() => expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith("/nodes/dev.scheduler/open-cmux"))).toBe(true));
    fireEvent.change(screen.getByPlaceholderText("Filter agents..."), { target: { value: "研究" } });
    expect(screen.getAllByTitle(label)).toHaveLength(2);
  });

  it.each([undefined, null, "  "])("retains the table's full logical-ID fallback for an empty label: %s", async (label) => {
    inventory([{ ...base, label }]);
    mount(<TopologyTableView />);
    const row = await screen.findByTestId("topology-table-row-dev.analyst");
    expect(within(row).getByTitle(base.logicalId).textContent).toBe(base.logicalId);
    expect(within(row).queryByText("analyst")).toBeNull();
  });

  it("shows labeled terminal headings without using the label as the terminal session", async () => {
    inventory([{ ...base, label: " Research Analyst (研究) " }]);
    mount(<TopologyTerminalView scope="rig" rigId="rig-1" />);
    expect(await screen.findByTitle("Research Analyst (研究)")).toBeDefined();
    expect(screen.getByTestId("terminal-session").textContent).toBe(base.canonicalSessionName);
    expect(screen.getByTitle(base.canonicalSessionName)).toBeDefined();
  });
});
