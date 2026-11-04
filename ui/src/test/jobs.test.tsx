// The jobs list against a stubbed API (fetch), through the real router, providers and shell.
import { screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { h1, renderAt } from "./render";

const job = {
  _id: "20261103-120000-abc123",
  name: "Reference perimeter",
  status: "running",
  created_at: "2026-11-03T12:00:00+00:00",
  started_at: "2026-11-03T12:00:01+00:00",
  finished_at: null,
  updated_at: "2026-11-03T12:05:00+00:00",
  error: null,
  return_code: null,
  demand_profile: "Baseline (LuST)",
  spec: {},
  perimeter: { region_edge_count: 314, region_length_km: 47.4, signals: Array.from({ length: 17 }, (_, i) => String(i)), action_bounds: [10, 55], crossings: { controlled: 87, other_lights: 40, unsignalised: 28 } },
  progress: { rounds_done: 3, rounds_total: 50, fraction: 0.06, eta_seconds: 1000, current: null },
};

function stubApi(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/training-jobs")) return Response.json({ items, total: items.length });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("lists training jobs with their status and progress", async () => {
  stubApi([job]);
  renderAt("/jobs");
  await h1("Training jobs");
  expect(await screen.findByRole("link", { name: "Reference perimeter" })).toHaveAttribute("href", `/jobs/${job._id}`);
  expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  expect(screen.getByText("Baseline (LuST)")).toBeInTheDocument();
  // the sidebar counts jobs that need watching
  expect(await screen.findByText("1")).toBeInTheDocument();
});

test("shows the empty state with a way to start", async () => {
  stubApi([]);
  renderAt("/jobs");
  expect(await screen.findByText("No training jobs yet")).toBeInTheDocument();
});

test("renders in Greek", async () => {
  stubApi([]);
  renderAt("/jobs", "el");
  await h1("Εκπαιδεύσεις");
});
