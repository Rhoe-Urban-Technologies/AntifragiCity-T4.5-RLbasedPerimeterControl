// 404 for unknown paths inside the shell.
import { ErrorPage } from "@rhoe/ui";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";

export function NotFoundPage() {
  const { t } = useLocale();
  usePage(t.pageTitle.notFound);
  return <ErrorPage variant="404" fullHeight={false} homeHref="/" />;
}
