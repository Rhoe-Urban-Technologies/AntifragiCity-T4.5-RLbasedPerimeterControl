// Page metadata: each page names itself (document title, top-bar breadcrumbs) with usePage().
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isApiError } from "@rhoe/data";
import type { BreadcrumbItem } from "@rhoe/ui";
import { useT, type Messages } from "../i18n";

export interface PageMeta {
  title: string;
  crumbs: BreadcrumbItem[];
}

const PageMetaContext = createContext<(meta: PageMeta) => void>(() => {});

export function PageMetaProvider({ children, onChange }: { children: ReactNode; onChange: (meta: PageMeta) => void }) {
  return <PageMetaContext.Provider value={onChange}>{children}</PageMetaContext.Provider>;
}

/** Sets the document title ("Sites · Rhoé Planning") and the breadcrumbs in the top bar. */
export function usePage(title: string, crumbs?: BreadcrumbItem[]) {
  const t = useT();
  const set = useContext(PageMetaContext);
  const key = JSON.stringify([title, crumbs]);
  useEffect(() => {
    document.title = title ? `${title} · ${t.appName}` : t.appName;
    set({ title, crumbs: crumbs ?? [{ label: title }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t.appName, set]);
}

export function usePageMetaState() {
  return useState<PageMeta>({ title: "", crumbs: [] });
}

/** A sentence for an API error: connection problems in the UI's words, the server's own message otherwise. */
export function errorText(error: unknown, t: Messages): string {
  if (isApiError(error)) {
    if (error.code === "network" || error.code === "aborted") return t.errors.network;
    if (error.code === "timeout") return t.errors.timeout;
    if (error.status >= 500) return t.errors.server;
    return error.message || t.errors.generic;
  }
  return t.errors.generic;
}
