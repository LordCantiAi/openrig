import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGlobalEvents } from "../src/hooks/useGlobalEvents.js";
import { useActivityFeed } from "../src/hooks/useActivityFeed.js";
import { createMockEventSourceClass, instances } from "./helpers/mock-event-source.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", createMockEventSourceClass());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([
  { name: "global events", hook: useGlobalEvents, graphInvalidated: false },
  { name: "activity feed", hook: useActivityFeed, graphInvalidated: true },
])("member-label updates through $name", ({ hook, graphInvalidated }) => {
  it.each(["Research Analyst (研究)", null])("invalidates cached inventory and details on set/clear, scoped by machine rig ID: %s", async (to) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const keys = [
      ["rig", "rig-1", "graph", "local"],
      ["rig", "rig-1", "nodes", "local"],
      ["rig", "rig-1", "nodes", "dev.analyst", "local"],
      ["rig", "rig-1", "nodes", "dev.analyst", "remote-host"],
      ["rig", "rig-2", "graph", "local"],
      ["rig", "rig-2", "nodes", "dev.analyst", "local"],
      ["rig", "Research Analyst (研究)", "nodes", "local"],
    ];
    for (const key of keys) client.setQueryData(key, { label: "Research Analyst (研究)" });
    renderHook(() => hook(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(() => Promise.resolve());

    act(() => {
      instances[0]!.simulateMessage(JSON.stringify({
        type: "node.label_changed", rigId: "rig-1", nodeId: "node-1", logicalId: "dev.analyst",
        from: "Research Analyst (研究)", to,
      }));
      vi.advanceTimersByTime(150);
    });

    expect(client.getQueryState(keys[0]!)?.isInvalidated).toBe(graphInvalidated);
    for (const key of keys.slice(1, 4)) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    // Equal labels / logical IDs do not identify a different rig, and labels are not cache addresses.
    for (const key of keys.slice(4)) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("does not invalidate rig caches for an event without a machine rig ID", async () => {
    const client = new QueryClient();
    const key = ["rig", "rig-1", "nodes", "dev.analyst", "local"];
    client.setQueryData(key, { label: "Analyst" });
    renderHook(() => hook(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(() => Promise.resolve());
    act(() => {
      instances[0]!.simulateMessage(JSON.stringify({ type: "node.label_changed", logicalId: "dev.analyst", to: "Renamed" }));
      vi.advanceTimersByTime(150);
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });
});
