import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
// The Rhoé kit (tokens, then the components' styles), then the AntifragiCity fonts and brand over the kit's tokens
// (as in antifragicity-ui's apps/suma), then the app's own few rules.
import "@rhoe/tokens/rhoe.css";
import "@rhoe/ui/styles.css";
import "@antifragicity/theme/fonts.css";
import "@antifragicity/theme/theme.css";
import "./app.css";
import { AppProviders } from "./app/providers";
import { routes } from "./app/routes";

const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
