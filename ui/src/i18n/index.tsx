// The app's language: English or Greek, remembered in localStorage, applied to <html lang>, @rhoe/ui (RhoeProvider)
// and the API (Accept-Language).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { INTL_LOCALE, type RhoeLocale } from "@rhoe/ui";
import { setApiLanguage } from "../api/client";
import { en, type Messages } from "./en";
import { el } from "./el";

export type { Messages };
const DICTIONARIES: Record<RhoeLocale, Messages> = { en, el };
const KEY = "suma-atc-locale";

interface LocaleState {
  locale: RhoeLocale;
  setLocale: (l: RhoeLocale) => void;
  t: Messages;
  /** Formatters in the active locale, dates in Europe/Athens. */
  fmt: ReturnType<typeof formatters>;
}

const LocaleContext = createContext<LocaleState | null>(null);

function initialLocale(): RhoeLocale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "el") return saved;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== "undefined" && navigator.language?.startsWith("el") ? "el" : "en";
}

export function formatters(locale: RhoeLocale) {
  const intl = INTL_LOCALE[locale];
  const tz = "Europe/Athens";
  const date = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: tz });
  const shortDate = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: tz });
  const dateTime = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const number = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 });
  const eur = new Intl.NumberFormat(intl, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  // "2026-10-29" is a calendar day: read it at noon UTC so no time zone moves it
  const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return {
    date: (iso: string | null | undefined) => (iso ? date.format(day(iso)) : "—"),
    shortDate: (iso: string) => shortDate.format(day(iso)),
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
    number: (n: number) => number.format(n),
    kw: (n: number) => `${number.format(n)} kW`,
    eur: (n: number) => eur.format(n),
    pct: (n: number) => `${number.format(n)}%`,
    list: (items: string[]) => new Intl.ListFormat(intl, { type: "conjunction" }).format(items),
  };
}

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: RhoeLocale }) {
  const [locale, setLocaleState] = useState<RhoeLocale>(() => initial ?? initialLocale());
  setApiLanguage(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<LocaleState>(
    () => ({
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        try {
          localStorage.setItem(KEY, l);
        } catch {
          /* this tab only */
        }
      },
      t: DICTIONARIES[locale],
      fmt: formatters(locale),
    }),
    [locale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

/** The app's strings in the active language. */
export const useT = () => useLocale().t;
