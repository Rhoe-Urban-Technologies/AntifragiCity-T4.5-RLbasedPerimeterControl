// One training job: RunPanel with live progress and the trainer's log, the per-round metrics as charts, and the
// perimeter it trains. Polls while queued or running.
import { useParams } from "react-router";
import { Copy } from "lucide-react";
import { Card, CardHeader, ChartFrame, ErrorPage, ErrorState, Icon, KpiTile, LineChart, LinkButton, LogViewer, PageHeader, RunPanel, Skeleton, StatusPill, formatDuration, useConfirm, type LogLevel } from "@rhoe/ui";
import { useApiMutation } from "@rhoe/data";
import { isNotFound } from "../../api/client";
import { jobKeys, jobsApi, useJob, useJobLog } from "../../api/queries";
import type { TrainingRound } from "../../api/types";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";

const level = (line: string): LogLevel =>
  /error|traceback|exception/i.test(line) ? "error" : /warning/i.test(line) ? "warning" : line.startsWith("$ ") ? "debug" : "info";

export function JobDetail() {
  const { id = "" } = useParams();
  const { t, fmt, locale } = useLocale();
  const job = useJob(id);
  const j = job.data;
  const active = j?.status === "queued" || j?.status === "running";
  const log = useJobLog(id, !!active);
  const confirm = useConfirm();
  usePage(j?.name ?? t.job.title, [{ label: t.jobs.title, href: "/jobs" }, { label: j?.name ?? t.job.title }]);

  const cancel = useApiMutation({ mutationFn: jobsApi.cancel, invalidate: () => [jobKeys.all] });

  if (job.isError && isNotFound(job.error)) return <ErrorPage variant="404" fullHeight={false} homeHref="/jobs" />;
  if (job.isError) return <ErrorState title={t.job.loadFailed} error={job.error} onRetry={() => void job.refetch()} isRetrying={job.isFetching} />;
  if (!j) return <Skeleton lines={8} />;

  const rounds: TrainingRound[] = j.rounds ?? [];
  const labels = rounds.map((r) => String(r.episode));
  const last = rounds[rounds.length - 1];
  const p = j.progress;
  const step =
    j.status === "queued"
      ? t.job.waiting
      : p.current
        ? t.job.step(p.current.episode + 1, p.rounds_total, p.current.simulations_done, p.current.simulations)
        : j.status === "running"
          ? t.job.starting
          : undefined;

  const onCancel = async () => {
    if (await confirm({ title: t.job.cancelTitle(j.name), description: t.job.cancelBody, confirmLabel: t.job.cancelConfirm, tone: "danger" })) cancel.mutate(j._id);
  };

  return (
    <div className="app-stack">
      <PageHeader
        title={j.name}
        description={t.job.description(j.demand_profile, j.perimeter.signals.length, j.perimeter.region_edge_count)}
        meta={<StatusPill status={j.status} />}
        actions={
          <LinkButton href={`/?from=${j._id}`} iconStart={<Icon icon={Copy} />}>
            {t.job.reuse}
          </LinkButton>
        }
      />

      <div className="app-kpis">
        <KpiTile label={t.job.kpiRounds} value={t.jobs.rounds(p.rounds_done, p.rounds_total)} context={p.eta_seconds ? t.job.eta(formatDuration(p.eta_seconds * 1000, locale)) : undefined} />
        <KpiTile
          label={t.job.kpiCompleted}
          value={last?.mean_completed ?? "—"}
          context={t.job.kpiCompletedContext}
          trend={rounds.slice(-12).map((r) => r.mean_completed ?? 0)}
        />
        <KpiTile label={t.job.kpiTts} value={last?.mean_tts != null ? fmt.number(last.mean_tts / 3600) : "—"} context={t.job.kpiTtsContext} trend={rounds.slice(-12).map((r) => (r.mean_tts ?? 0) / 3600)} />
        <KpiTile label={t.job.kpiBounds} value={t.common.range(fmt.number(j.perimeter.action_bounds[0]), fmt.number(j.perimeter.action_bounds[1]))} context={t.job.kpiBoundsContext} />
      </div>

      <div className="app-tool">
        <RunPanel
          title={t.job.runTitle}
          status={j.status}
          progress={j.status === "running" || j.status === "completed" ? Math.round(p.fraction * 100) : undefined}
          step={step}
          startedAt={j.started_at ? new Date(j.started_at) : undefined}
          finishedAt={j.finished_at ? new Date(j.finished_at) : undefined}
          error={j.status === "failed" ? (j.error ?? t.job.failed) : undefined}
          onCancel={active ? () => void onCancel() : undefined}
          outputs={j.status === "completed" ? <p className="app-muted">{t.job.outputs(j._id)}</p> : undefined}
          logs={
            <LogViewer
              label={t.job.logLabel}
              height={320}
              showTime={false}
              lines={(log.data?.lines ?? []).map((message) => ({ level: level(message), message }))}
            />
          }
        />
        <div className="app-stack">
          <ChartFrame
            title={t.job.chartCompleted}
            description={t.job.chartCompletedDescription}
            table={{ columns: [t.job.colRound, t.job.colCompleted, t.job.colTts], rows: rounds.map((r) => [r.episode, r.mean_completed ?? "", r.mean_tts != null ? Math.round(r.mean_tts / 3600) : ""]) }}
            downloadCsv={`${j._id}-rounds.csv`}
          >
            {rounds.length ? (
              <LineChart labels={labels} series={[{ name: t.job.colCompleted, values: rounds.map((r) => r.mean_completed) }]} summary={t.job.summaryCompleted(rounds.length)} zeroBased={false} />
            ) : (
              <p className="app-muted">{t.job.noRounds}</p>
            )}
          </ChartFrame>
          <ChartFrame title={t.job.chartLoss} description={t.job.chartLossDescription}>
            {rounds.length ? (
              <LineChart
                labels={labels}
                series={[
                  { name: t.job.criticLoss, values: rounds.map((r) => r.critic_loss) },
                  { name: t.job.actorLoss, values: rounds.map((r) => r.actor_loss) },
                ]}
                summary={t.job.summaryLoss(rounds.length)}
                zeroBased={false}
                format={(v) => (v === 0 ? "0" : Math.abs(v) < 0.01 || Math.abs(v) >= 1e4 ? v.toExponential(1) : String(Number(v.toPrecision(2))))}
              />
            ) : (
              <p className="app-muted">{t.job.noRounds}</p>
            )}
          </ChartFrame>
          <Card>
            <CardHeader title={t.job.perimeterTitle} description={t.job.perimeterDescription(fmt.number(j.perimeter.region_length_km))} />
            <dl className="app-facts">
              <div>
                <dt>{t.job.controlled}</dt>
                <dd>{fmt.number(j.perimeter.crossings.controlled)}</dd>
              </div>
              <div>
                <dt>{t.job.uncontrolled}</dt>
                <dd>{fmt.number(j.perimeter.crossings.other_lights + j.perimeter.crossings.unsignalised)}</dd>
              </div>
            </dl>
            <p className="atc-ids" aria-label={t.job.lightIds}>
              {j.perimeter.signals.join(" · ")}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default JobDetail;
