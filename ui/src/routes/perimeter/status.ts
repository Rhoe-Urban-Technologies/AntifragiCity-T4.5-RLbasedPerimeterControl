import type { StatusTone } from "@rhoe/ui";
import type { MapPalette, MapStatus } from "@rhoe/ui/maps";
import type { LightStatus } from "../../api/types";

/** Region A on the map: the theme's 4th series colour (AntifragiCity teal), clear of the red error status. */
export const REGION_SERIES = 3;

/**
 * Region A's colour from the page's tokens (--rh-series-4 of @antifragicity/theme, light or dark). mapPalette() has
 * the Rhoé kit's own colours, not the project theme's, so the map layers get this one, like the legend swatch.
 */
export function regionColor(palette: MapPalette): string {
  const token = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(`--rh-series-${REGION_SERIES + 1}`).trim();
  return token || palette.series[REGION_SERIES];
}

/** A perimeter light's status on the map: shape and colour together (circle OK, triangle warning, diamond error). */
export const LIGHT_MAP_STATUS: Record<LightStatus, MapStatus> = {
  ok: "success",
  warning: "warning",
  error: "danger",
  excluded: "neutral",
};

export const LIGHT_TONE: Record<LightStatus, StatusTone> = {
  ok: "success",
  warning: "warning",
  error: "danger",
  excluded: "neutral",
};

export const LIGHT_STATUSES: MapStatus[] = ["success", "warning", "danger", "neutral"];

/** Map feature ids for lights: prefixed so they never collide with edge ids on the same map. */
export const lightFeatureId = (id: string) => `tls:${id}`;
export const lightIdOf = (featureId: string | number | null) =>
  typeof featureId === "string" && featureId.startsWith("tls:") ? featureId.slice(4) : null;
