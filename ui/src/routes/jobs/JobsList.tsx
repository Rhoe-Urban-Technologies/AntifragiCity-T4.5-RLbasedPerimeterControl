// Training jobs, newest first. Polls while any job is queued or running.
import { Plus } from "lucide-react";
import { DataTable, EmptyState, ErrorState, Icon, Link, LinkButton, PageHeader, ProgressBar, StatusPill } from "@rhoe/ui";
import { useJobs } from "../../api/queries";
import type { TrainingJob } from "../../api/types";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";

export function JobsList() {
  const { t, fmt } = useLocale();
  usePage(t.jobs.title);
  const jobs = useJobs();
  const rows = jobs.data?.items ?? [];

  return (
    <div className="app-stack">
      <PageHeader
        title={t.jobs.title}
        description={t.jobs.description}
        actions={
          <LinkButton href="/" variant="primary" iconStart={<Icon icon={Plus} />}>
            {t.jobs.new}
          </LinkButton>
        }
      />
      {jobs.isError ? (
        <ErrorState title={t.jobs.loadFailed} error={jobs.error} onRetry={() => void jobs.refetch()} isRetrying={jobs.isFetching} headingLevel={2} />
      ) : (
        <DataTable<TrainingJob>
          label={t.jobs.title}
          rows={rows}
          isLoading={jobs.isLoading}
          columns={[
            { id: "name", name: t.jobs.colName, isRowHeader: true, render: (j) => <Link href={`/jobs/${j._id}`}>{j.name}</Link> },
            { id: "status", name: t.jobs.colStatus, render: (j) => <StatusPill status={j.status} /> },
            {
              id: "progress",
              name: t.jobs.colProgress,
              render: (j) => (
                <div className="atc-progress-cell">
                  <ProgressBar
                    label={t.jobs.progressLabel(j.name)}
                    value={j.progress.fraction * 100}
                    valueLabel={t.jobs.rounds(j.progress.rounds_done, j.progress.rounds_total)}
                    hideLabel
                    tone={j.status === "failed" ? "danger" : j.status === "completed" ? "success" : "accent"}
                  />
                </div>
              ),
            },
            { id: "demand_profile", name: t.jobs.colDemand },
            { id: "lights", name: t.jobs.colLights, align: "end", render: (j) => fmt.number(j.perimeter.signals.length) },
            { id: "created_at", name: t.jobs.colCreated, allowsSorting: false, render: (j) => fmt.dateTime(j.created_at) },
          ]}
          emptyState={
            <EmptyState
              title={t.jobs.empty}
              description={t.jobs.emptyHint}
              action={
                <LinkButton href="/" variant="primary">
                  {t.jobs.new}
                </LinkButton>
              }
            />
          }
        />
      )}
    </div>
  );
}
