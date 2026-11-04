// Every route. Pages live in src/routes; the shell in src/app.
// The perimeter page (MapLibre) and the job page (charts) are lazy routes: their heavy dependencies load with them.
import type { ComponentType } from "react";
import type { RouteObject } from "react-router";
import { Loader } from "@rhoe/ui";
import { useLocale } from "../i18n";
import { Root, RouteError } from "./Root";
import { Shell } from "./Shell";
import { JobsList } from "../routes/jobs/JobsList";
import { NotFoundPage } from "../routes/errors/ErrorRoutes";

/** A lazy route: the page's chunk, loaded on the first visit. */
const page = (load: () => Promise<ComponentType>) => async () => ({ Component: await load() });

function AppLoading() {
  const { t } = useLocale();
  return (
    <div className="app-loading">
      <Loader variant="pattern" size="lg" label={t.common.loading} />
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        hydrateFallbackElement: <AppLoading />,
        children: [
          { index: true, lazy: page(async () => (await import("../routes/perimeter/PerimeterPage")).PerimeterPage) },
          { path: "jobs", element: <JobsList /> },
          { path: "jobs/:id", lazy: page(async () => (await import("../routes/jobs/JobDetail")).JobDetail) },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
