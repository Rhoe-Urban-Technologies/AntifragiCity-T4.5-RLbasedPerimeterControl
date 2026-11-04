// Every comparison with fixed-time control, newest first. Polls while any is queued or running.
import { EmptyState, ErrorState, LinkButton, PageHeader } from "@rhoe/ui";
import { useComparisons } from "../../api/queries";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";
import { ComparisonsTable } from "./ComparisonsTable";

export function ComparisonsList() {
  const { t } = useLocale();
  usePage(t.comparisons.title);
  const comparisons = useComparisons();
  return (
    <div className="app-stack">
      <PageHeader title={t.comparisons.title} description={t.comparisons.description} />
      {comparisons.isError ? (
        <ErrorState title={t.comparisons.loadFailed} error={comparisons.error} onRetry={() => void comparisons.refetch()} isRetrying={comparisons.isFetching} headingLevel={2} />
      ) : (
        <ComparisonsTable
          rows={comparisons.data?.items ?? []}
          isLoading={comparisons.isLoading}
          showTraining
          emptyState={
            <EmptyState
              title={t.comparisons.empty}
              description={t.comparisons.emptyHint}
              action={
                <LinkButton href="/jobs" variant="primary">
                  {t.comparisons.toJobs}
                </LinkButton>
              }
            />
          }
        />
      )}
    </div>
  );
}
