// Comparisons as a table: on the comparisons page (with the training job column) and on a training job's page.
import type { ReactNode } from "react";
import { DataTable, Link, ProgressBar, StatusPill } from "@rhoe/ui";
import type { Comparison } from "../../api/types";
import { useLocale } from "../../i18n";
import { agentRow, signedPct } from "./format";

interface ComparisonsTableProps {
  rows: Comparison[];
  isLoading?: boolean;
  /** Show which training job each comparison is for (the all-comparisons page). */
  showTraining?: boolean;
  emptyState: ReactNode;
}

export function ComparisonsTable({ rows, isLoading, showTraining, emptyState }: ComparisonsTableProps) {
  const { t, fmt, locale } = useLocale();
  return (
    <DataTable<Comparison>
      label={t.comparisons.title}
      rows={rows}
      isLoading={isLoading}
      columns={[
        { id: "name", name: t.comparisons.colName, isRowHeader: true, render: (c) => <Link href={`/comparisons/${c._id}`}>{c.name}</Link> },
        { id: "status", name: t.comparisons.colStatus, render: (c) => <StatusPill status={c.status} /> },
        {
          id: "progress",
          name: t.comparisons.colProgress,
          render: (c) => (
            <div className="atc-progress-cell">
              <ProgressBar
                label={t.jobs.progressLabel(c.name)}
                value={c.progress.fraction * 100}
                valueLabel={t.comparisons.progress(c.progress.runs_done, c.progress.runs_total)}
                hideLabel
                tone={c.status === "failed" ? "danger" : c.status === "completed" ? "success" : "accent"}
              />
            </div>
          ),
        },
        ...(showTraining
          ? [{ id: "training", name: t.comparisons.colTraining, render: (c: Comparison) => <Link href={`/jobs/${c.spec.training_job_id}`}>{c.spec.training_job_name}</Link> }]
          : []),
        { id: "demand_profile", name: t.comparisons.colDemand },
        {
          id: "agent",
          name: t.comparisons.colAgent,
          render: (c) => {
            const a = agentRow(c);
            return a?.completed_change != null ? t.comparisons.agentChange(signedPct(a.completed_change, locale), signedPct(a.tts_change, locale)) : "—";
          },
        },
        { id: "created_at", name: t.comparisons.colCreated, render: (c) => fmt.dateTime(c.created_at) },
      ]}
      emptyState={emptyState}
    />
  );
}
