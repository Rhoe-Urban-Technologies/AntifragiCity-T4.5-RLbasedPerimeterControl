// One comparison with fixed-time control: the D4.5-style table (completed trips and total time spent per
// controller, change against the best fixed budget), the change as bars, the B→A green and the vehicles in Region A
// per cycle, then the run itself (progress, log) and its settings. Polls while queued or running.
import { useParams } from "react-router";
import { ArrowLeft, Repeat } from "lucide-react";
import {
  BarChart,
  Card,
  CardHeader,
  ChartFrame,
  DataTable,
  ErrorPage,
  ErrorState,
  Icon,
  KpiTile,
  LineChart,
  LinkButton,
  LogViewer,
  PageHeader,
  RunPanel,
  Skeleton,
  StatusPill,
  formatDuration,
  useConfirm,
  type KpiDelta,
  type LogLevel,
} from "@rhoe/ui";
import { useApiMutation } from "@rhoe/data";
import { isNotFound } from "../../api/client";
import { comparisonKeys, comparisonsApi, useComparison, useComparisonLog } from "../../api/queries";
import type { ComparisonResults, ComparisonRow } from "../../api/types";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";
import { clock, controllerName, signedPct } from "./format";

const level = (line: string): LogLevel =>
  /error|traceback|exception/i.test(line) ? "error" : /warning/i.test(line) ? "warning" : line.startsWith("$ ") ? "debug" : "info";

/** LineChart draws up to six series: every fixed budget up to five, and the agent. */
const MAX_LINES = 6;

const EMPTY: ComparisonResults = { summary: [], cycles: {}, runs: [] };

function delta(change: number | null, locale: string, period: string, lowerIsBetter: boolean): KpiDelta | undefined {
  if (change == null) return undefined;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const good = lowerIsBetter ? change < 0 : change > 0;
  return { value: signedPct(change, locale), direction, sentiment: change === 0 ? "neutral" : good ? "good" : "bad", period };
}

export function ComparisonDetail() {
  const { id = "" } = useParams();
  const { t, fmt, locale } = useLocale();
  const query = useComparison(id);
  const c = query.data;
  const active = c?.status === "queued" || c?.status === "running";
  const log = useComparisonLog(id, !!active);
  const confirm = useConfirm();
  usePage(c?.name ?? t.comparison.title, [{ label: t.comparisons.title, href: "/comparisons" }, { label: c?.name ?? t.comparison.title }]);
  const cancel = useApiMutation({ mutationFn: comparisonsApi.cancel, invalidate: () => [comparisonKeys.all] });

  if (query.isError && isNotFound(query.error)) return <ErrorPage variant="404" fullHeight={false} homeHref="/comparisons" />;
  if (query.isError) return <ErrorState title={t.comparison.loadFailed} error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!c) return <Skeleton lines={8} />;

  const results = Array.isArray(c.results) ? EMPTY : c.results;
  const name = (controller: string) => controllerName(t, controller, fmt.number);
  const summary = results.summary;
  const agent = summary.find((r) => r.controller === "agent");
  const best = summary.find((r) => r.controller === r.best_fixed);
  const bestName = best ? name(best.controller) : "";
  const p = c.progress;

  // per-cycle charts: the clock labels of the longest series, at most six lines (the agent always among them)
  const ids = Object.keys(results.cycles);
  const shown = [...ids.filter((x) => x !== "agent").slice(0, ids.includes("agent") ? MAX_LINES - 1 : MAX_LINES), ...(ids.includes("agent") ? ["agent"] : [])];
  const longest = ids.reduce<string | null>((a, x) => (a && results.cycles[a].length >= results.cycles[x].length ? a : x), null);
  const labels = longest ? results.cycles[longest].map((r) => clock(r.time)) : [];
  const series = (key: "ba_seconds" | "accumulation_a") =>
    shown.map((x) => ({ name: name(x), values: labels.map((_, i) => results.cycles[x][i]?.[key] ?? null) }));
  const cycleTable = (key: "ba_seconds" | "accumulation_a") => ({
    columns: [t.comparison.colTime, ...shown.map(name)],
    rows: labels.map((l, i) => [l, ...shown.map((x) => (results.cycles[x][i] ? Math.round(results.cycles[x][i][key] * 10) / 10 : ""))]),
  });
  const changed = summary.filter((r) => r.controller !== r.best_fixed && r.completed_change != null);

  const onCancel = async () => {
    if (await confirm({ title: t.comparison.cancelTitle(c.name), description: t.comparison.cancelBody, confirmLabel: t.comparison.cancelConfirm, tone: "danger" }))
      cancel.mutate(c._id);
  };

  return (
    <div className="app-stack">
      <PageHeader
        title={c.name}
        description={t.comparison.description(c.demand_profile, c.spec.sumo_seeds.length)}
        meta={<StatusPill status={c.status} />}
        actions={
          <>
            <LinkButton href={`/jobs/${c.spec.training_job_id}`} iconStart={<Icon icon={ArrowLeft} />}>
              {t.comparison.training}
            </LinkButton>
            <LinkButton href={`/jobs/${c.spec.training_job_id}?compare=1`} iconStart={<Icon icon={Repeat} />}>
              {t.comparison.rerun}
            </LinkButton>
          </>
        }
      />

      <div className="app-kpis">
        {agent && (
          <>
            <KpiTile label={t.comparison.kpiAgentCompleted} value={fmt.number(agent.completed)} delta={delta(agent.completed_change, locale, t.comparison.vsBest(bestName), false)} />
            <KpiTile label={t.comparison.kpiAgentTts} value={fmt.number(Math.round(agent.tts))} context="veh·s" delta={delta(agent.tts_change, locale, t.comparison.vsBest(bestName), true)} />
          </>
        )}
        {best && <KpiTile label={t.comparison.kpiBest} value={bestName} context={`${t.comparison.kpiBestContext}: ${fmt.number(Math.round(best.tts))} veh·s`} />}
        <KpiTile label={t.comparison.runTitle} value={t.comparisons.progress(p.runs_done, p.runs_total)} context={p.eta_seconds ? t.job.eta(formatDuration(p.eta_seconds * 1000, locale)) : undefined} />
      </div>

      <Card>
        <CardHeader level={2} title={t.comparison.tableTitle} description={t.comparison.tableDescription} />
        <DataTable<ComparisonRow>
          label={t.comparison.tableTitle}
          rows={summary}
          getRowId={(r) => r.controller}
          isLoading={query.isLoading}
          columns={[
            {
              id: "controller",
              name: t.comparison.colController,
              isRowHeader: true,
              render: (r) => (
                <span className={r.controller === "agent" ? "atc-strong" : undefined}>
                  {name(r.controller)}
                  {r.controller === r.best_fixed && <span className="app-muted"> · {t.comparison.best}</span>}
                </span>
              ),
            },
            { id: "completed", name: t.comparison.colCompleted, align: "end", render: (r) => fmt.number(r.completed) },
            { id: "tts", name: t.comparison.colTts, align: "end", render: (r) => fmt.number(Math.round(r.tts)) },
            { id: "completed_change", name: t.comparison.colCompletedChange, align: "end", render: (r) => signedPct(r.completed_change, locale) },
            { id: "tts_change", name: t.comparison.colTtsChange, align: "end", render: (r) => signedPct(r.tts_change, locale) },
          ]}
          emptyState={<p className="app-muted">{t.comparison.noResults}</p>}
        />
      </Card>

      {summary.length > 0 && (
        <div className="app-charts">
          {changed.length > 0 && (
            <ChartFrame
              title={t.comparison.changeChart}
              description={t.comparison.changeChartDescription}
              table={{
                columns: [t.comparison.colController, t.comparison.changeCompleted, t.comparison.changeTts],
                rows: changed.map((r) => [name(r.controller), signedPct(r.completed_change, locale), signedPct(r.tts_change, locale)]),
              }}
              downloadCsv={`${c._id}-change.csv`}
            >
              <BarChart
                categories={changed.map((r) => name(r.controller))}
                series={[
                  { name: t.comparison.changeCompleted, values: changed.map((r) => (r.completed_change ?? 0) * 100) },
                  { name: t.comparison.changeTts, values: changed.map((r) => (r.tts_change ?? 0) * 100) },
                ]}
                format={(v) => `${fmt.number(v)}%`}
                summary={t.comparison.changeSummary(bestName)}
              />
            </ChartFrame>
          )}
          <ChartFrame title={t.comparison.actionChart} description={t.comparison.actionChartDescription} table={cycleTable("ba_seconds")} downloadCsv={`${c._id}-ba-green.csv`}>
            <LineChart labels={labels} series={series("ba_seconds")} summary={t.comparison.actionSummary} format={(v) => `${fmt.number(v)} s`} />
          </ChartFrame>
          <ChartFrame
            title={t.comparison.accumulationChart}
            description={t.comparison.accumulationChartDescription}
            table={cycleTable("accumulation_a")}
            downloadCsv={`${c._id}-region-a.csv`}
          >
            <LineChart labels={labels} series={series("accumulation_a")} summary={t.comparison.accumulationSummary} />
          </ChartFrame>
        </div>
      )}

      <div className="app-tool">
        <RunPanel
          title={t.comparison.runTitle}
          status={c.status}
          progress={c.status === "running" || c.status === "completed" ? Math.round(p.fraction * 100) : undefined}
          step={c.status === "queued" ? t.comparison.waiting : c.status === "running" ? (p.runs_done ? t.comparison.step(p.runs_done, p.runs_total) : t.comparison.starting) : undefined}
          startedAt={c.started_at ? new Date(c.started_at) : undefined}
          finishedAt={c.finished_at ? new Date(c.finished_at) : undefined}
          error={c.status === "failed" ? (c.error ?? t.comparison.failed) : undefined}
          onCancel={active ? () => void onCancel() : undefined}
          outputs={c.status === "completed" ? <p className="app-muted">{t.comparison.outputs(c._id)}</p> : undefined}
          logs={<LogViewer label={t.comparison.logLabel} height={320} showTime={false} lines={(log.data?.lines ?? []).map((message) => ({ level: level(message), message }))} />}
        />
        <div className="app-stack">
          <Card>
            <CardHeader level={2} title={t.comparison.settings} />
            <dl className="app-facts">
              <div>
                <dt>{t.comparison.training}</dt>
                <dd>{c.spec.training_job_name}</dd>
              </div>
              <div>
                <dt>{t.comparison.settingAgent}</dt>
                <dd>{c.spec.agent_rounds != null ? t.comparison.agentRounds(c.spec.agent_rounds) : t.comparison.noAgent}</dd>
              </div>
              <div>
                <dt>{t.comparison.settingSeeds}</dt>
                <dd>{c.spec.sumo_seeds.join(", ")}</dd>
              </div>
              <div>
                <dt>{t.comparison.settingWindow}</dt>
                <dd>
                  {clock(c.spec.begin)}–{clock(c.spec.begin + c.spec.duration)}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader level={2} title={t.comparison.seedsTitle} />
            <DataTable
              label={t.comparison.seedsTitle}
              rows={results.runs}
              getRowId={(r) => `${r.controller}-${r.sumo_seed}`}
              density="compact"
              columns={[
                { id: "controller", name: t.comparison.colController, isRowHeader: true, render: (r) => name(r.controller) },
                { id: "sumo_seed", name: t.comparison.colSeed, align: "end" },
                { id: "completed", name: t.comparison.colCompleted, align: "end", render: (r) => fmt.number(r.completed) },
                { id: "tts", name: t.comparison.colTts, align: "end", render: (r) => fmt.number(r.tts) },
                { id: "elapsed_seconds", name: t.comparison.colElapsed, align: "end", render: (r) => formatDuration(r.elapsed_seconds * 1000, locale) },
              ]}
              emptyState={<p className="app-muted">{t.comparison.noResults}</p>}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default ComparisonDetail;
