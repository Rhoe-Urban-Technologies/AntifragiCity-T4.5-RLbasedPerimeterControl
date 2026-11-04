// Render the app's router at a path (stub fetch for the API).
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { createQueryClient } from "@rhoe/data";
import type { RhoeLocale } from "@rhoe/ui";
import { AppProviders } from "../app/providers";
import { routes } from "../app/routes";

export function renderAt(path: string, locale: RhoeLocale = "en") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders locale={locale} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

export const h1 = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name }, { timeout: 8000 });

/** The current URL's query, parsed. */
export const searchOf = (router: ReturnType<typeof renderAt>) => new URLSearchParams(router.state.location.search);
