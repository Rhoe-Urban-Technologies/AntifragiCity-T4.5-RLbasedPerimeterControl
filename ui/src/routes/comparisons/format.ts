// Shared bits of the comparison pages: controller names, signed percentages, clock times.
import type { Comparison, ComparisonRow } from "../../api/types";
import type { Messages } from "../../i18n";

/** "fixed-32.5" → "Fixed 32.5 s" (decimal point in the locale), "agent" → "Trained agent". */
export function controllerName(t: Messages, controller: string, number: (n: number) => string): string {
  if (controller === "agent") return t.controller.agent;
  const seconds = Number(controller.replace(/^fixed-/, ""));
  return t.controller.fixed(Number.isFinite(seconds) ? number(seconds) : controller);
}

/** A fraction as a signed percentage with two decimals: 0.0064 → "+0.64%", -0.0237 → "−2.37%". */
export function signedPct(fraction: number | null | undefined, locale: string): string {
  if (fraction == null) return "—";
  const text = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(fraction);
  return text.replace("-", "−");
}

/** Seconds after midnight → "08:30". */
export const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 3600) % 24).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;

/** The summary rows, whether the API sent the list shape or the detail shape. */
export const summaryOf = (c: Comparison): ComparisonRow[] => (Array.isArray(c.results) ? c.results : c.results.summary);

/** The agent's row, if the comparison has one with results. */
export const agentRow = (c: Comparison) => summaryOf(c).find((r) => r.controller === "agent");
