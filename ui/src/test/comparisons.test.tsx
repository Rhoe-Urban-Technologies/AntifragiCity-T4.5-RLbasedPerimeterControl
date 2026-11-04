// Comparisons with fixed-time control against a stubbed API: the results page, and starting one from a training job.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { parseSeeds } from "../routes/comparisons/ComparisonDrawer";
import { h1, renderAt } from "./render";

const perimeter = { region_edge_count: 314, region_length_km: 47.4, signals: ["a", "b"], action_bounds: [10, 55], crossings: { controlled: 87, other_lights: 40, unsignalised: 28 } };

const training = {
  _id: "20261104-100000-aaaaaa",
  kind: "training",
  has_agent: true,
  name: "Reference perimeter",
  status: "completed",
  created_at: "2026-11-04T10:00:00+00:00",
  started_at: "2026-11-04T10:00:01+00:00",
  finished_at: "2026-11-04T15:00:00+00:00",
  updated_at: "2026-11-04T15:00:00+00:00",
  error: null,
  return_code: 0,
  demand_profile: "AA+3000",
  spec: { demand_profile: "aa_plus3000", name: "Reference perimeter", region_a_edges: [], overrides: {}, training: {} },
  perimeter,
  progress: { rounds_done: 50, rounds_total: 50, fraction: 1, eta_seconds: null, current: null },
  rounds: [],
};

const row = (controller: string, completed: number, tts: number, best: number[]) => ({
  controller,
  runs: 1,
  completed,
  tts,
  best_fixed: "fixed-32.5",
  completed_change: completed / best[0] - 1,
  tts_change: tts / best[1] - 1,
});
const best = [21928, 18286670];
const cycles = (ba: number) => [0, 1].map((i) => ({ time: 28800 + 90 * i, ba_seconds: ba, completed: 10, tts: 1000, accumulation_a: 50 + i, accumulation_b: 500 }));

const comparison = {
  _id: "20261104-160000-bbbbbb",
  kind: "comparison",
  name: "Reference perimeter · AA+3000",
  status: "completed",
  created_at: "2026-11-04T16:00:00+00:00",
  started_at: "2026-11-04T16:00:01+00:00",
  finished_at: "2026-11-04T16:06:00+00:00",
  updated_at: "2026-11-04T16:06:00+00:00",
  error: null,
  return_code: 0,
  demand_profile: "AA+3000",
  spec: {
    demand_profile: "aa_plus3000",
    fixed_budgets: [10, 32.5, 55],
    include_agent: true,
    sumo_seeds: [42],
    workers: 4,
    training_job_id: training._id,
    training_job_name: training.name,
    agent_rounds: 50,
    begin: 28800,
    duration: 3600,
    min_green: 5,
    controllers: ["fixed-10", "fixed-32.5", "fixed-55", "agent"],
  },
  perimeter,
  progress: { runs_done: 4, runs_total: 4, fraction: 1, eta_seconds: null },
  results: {
    summary: [row("fixed-10", 20887, 19241535, best), row("fixed-32.5", 21928, 18286670, best), row("fixed-55", 21274, 19228014, best), row("agent", 22068, 17853648, best)],
    cycles: { "fixed-10": cycles(10), "fixed-32.5": cycles(32.5), "fixed-55": cycles(55), agent: cycles(31) },
    runs: [{ controller: "agent", sumo_seed: 42, completed: 22068, tts: 17853648, elapsed_seconds: 330 }],
  },
};

function stubApi() {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = String(request ? request.url : input);
      const method = request?.method ?? init?.method ?? "GET";
      if (method === "POST" && url.includes("/comparisons")) {
        const text = request ? await request.text() : String(init?.body ?? "");
        posts.push({ url, body: JSON.parse(text) });
        return Response.json({ ...comparison, status: "queued" }, { status: 201 });
      }
      if (url.includes(`/comparisons/${comparison._id}/log`)) return Response.json({ lines: ["$ python -m shared_green_rl.evaluate"] });
      if (url.includes(`/comparisons/${comparison._id}`)) return Response.json(comparison);
      if (url.includes("/comparisons")) return Response.json({ items: [{ ...comparison, results: comparison.results.summary }], total: 1 });
      if (url.includes(`/training-jobs/${training._id}/log`)) return Response.json({ lines: [] });
      if (url.includes(`/training-jobs/${training._id}`)) return Response.json(training);
      if (url.includes("/training-jobs")) return Response.json({ items: [training], total: 1 });
      if (url.includes("/demand-profiles"))
        return Response.json({ items: [{ _id: "aa_plus3000", id: "aa_plus3000", name: "AA+3000", description: "Baseline plus 3,000 trips inside A.", trips_08_09: 28382 }], total: 1 });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }),
  );
  return posts;
}

afterEach(() => vi.unstubAllGlobals());

test("shows the D4.5-style table with the change against the best fixed budget", async () => {
  stubApi();
  renderAt(`/comparisons/${comparison._id}`);
  await h1(comparison.name);
  const table = await screen.findByRole("grid", { name: "Performance comparison" });
  const agent = within(table).getByRole("row", { name: /Trained agent/ });
  expect(agent).toHaveTextContent("22,068");
  expect(agent).toHaveTextContent("+0.64%");
  expect(agent).toHaveTextContent("−2.37%");
  expect(within(table).getByRole("row", { name: /Fixed 32.5 s/ })).toHaveTextContent("best fixed");
  expect(screen.getByText("Agent: completed trips")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "B→A green per cycle" })).toBeInTheDocument();
});

test("starts a comparison from a training job with the D4.5 defaults", async () => {
  const posts = stubApi();
  const user = userEvent.setup();
  const router = renderAt(`/jobs/${training._id}`);
  await h1(training.name);
  // the job's comparisons are listed on its page
  expect(await screen.findByRole("link", { name: comparison.name })).toHaveAttribute("href", `/comparisons/${comparison._id}`);
  await user.click(screen.getByRole("button", { name: "Compare with fixed time" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("textbox", { name: "Fixed budget 2" })).toHaveValue("32.5");
  await user.click(within(dialog).getByRole("button", { name: "Start comparison" }));
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toContain(`/training-jobs/${training._id}/comparisons`);
  expect(posts[0].body).toMatchObject({ demand_profile: "aa_plus3000", fixed_budgets: [10, 32.5, 55], include_agent: true, sumo_seeds: [42] });
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/comparisons/${comparison._id}`));
});

test("lists comparisons and renders in Greek", async () => {
  stubApi();
  renderAt("/comparisons", "el");
  await h1("Συγκρίσεις με σταθερό χρόνο");
  expect(await screen.findByText("+0,64% διαδρομές · −2,37% συνολικός χρόνος")).toBeInTheDocument();
});

test("parses SUMO seeds", () => {
  expect(parseSeeds("42, 43 44;42")).toEqual([42, 43, 44]);
  expect(parseSeeds("42.5")).toBeNull();
  expect(parseSeeds("")).toBeNull();
});
