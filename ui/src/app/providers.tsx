// Everything above the router: language and TanStack Query (with the global error toast).
// No sign-in in this sample: SUMA's security layer (suma.storage → SUMA Security) will sit in front of the API.
// To add it, bring back the template's AuthProvider and src/auth (rhoe-ui templates/app-dashboard).
import { useRef, useState, type ReactNode } from "react";
import { RhoeQueryProvider, createQueryClient } from "@rhoe/data";
import { toast, type RhoeLocale } from "@rhoe/ui";
import type { QueryClient } from "@tanstack/react-query";
import { LocaleProvider, useT } from "../i18n";
import { errorText } from "./page";

function Query({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const t = useT();
  const latest = useRef(t);
  latest.current = t;
  const [queryClient] = useState(
    () =>
      client ??
      createQueryClient({
        // Mutations and failed background refetches get a toast; a page's first load shows its error inline.
        onError: (error, { kind, hasData }) => {
          if (kind === "mutation" || hasData) toast.error(errorText(error, latest.current));
        },
      }),
  );
  return <RhoeQueryProvider client={queryClient}>{children}</RhoeQueryProvider>;
}

export function AppProviders({ children, locale, queryClient }: { children: ReactNode; locale?: RhoeLocale; queryClient?: QueryClient }) {
  return (
    <LocaleProvider initial={locale}>
      <Query client={queryClient}>{children}</Query>
    </LocaleProvider>
  );
}
