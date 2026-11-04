// The router's root: @rhoe/ui's provider (language, routing for links, toasts, confirmations) and the
// maintenance switch. Route errors outside a page land in RouteError.
import { Outlet, isRouteErrorResponse, useHref, useNavigate, useRouteError, type NavigateOptions } from "react-router";
import { ErrorPage, RhoeProvider } from "@rhoe/ui";
import { config } from "../config";
import { useLocale } from "../i18n";
import { usePage } from "./page";

function Maintenance() {
  const { t } = useLocale();
  usePage(t.pageTitle.maintenance);
  return <ErrorPage variant="maintenance" />;
}

export function Root() {
  const navigate = useNavigate();
  const { locale } = useLocale();
  return (
    <RhoeProvider locale={locale} navigate={(to, options) => void navigate(to, options as NavigateOptions | undefined)} useHref={useHref} toaster>
      {config.maintenance ? <Maintenance /> : <Outlet />}
    </RhoeProvider>
  );
}

/** Errors the router catches outside the pages' own boundaries (a missing route, a crashing layout). */
export function RouteError() {
  const error = useRouteError();
  const { locale, t } = useLocale();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (typeof document !== "undefined") document.title = `${notFound ? t.pageTitle.notFound : t.pageTitle.error} · ${t.appName}`;
  return (
    <RhoeProvider locale={locale}>
      <ErrorPage variant={notFound ? "404" : "500"} homeHref="/" />
    </RhoeProvider>
  );
}
