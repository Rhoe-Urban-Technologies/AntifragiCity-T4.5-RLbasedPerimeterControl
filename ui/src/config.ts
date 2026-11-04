// Build-time settings from .env files (see .env.example). Vite exposes only VITE_* variables.

export const config = {
  /** The app's name next to the logo and in the document title. */
  productName: "SUMA · ATC",
  /** The ATC API. Default "/api": the Vite dev server proxies it to http://localhost:8000 (vite.config.ts). */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) || "/api",
  /** "true" shows the maintenance page instead of the app. */
  maintenance: import.meta.env.VITE_MAINTENANCE === "true",
  /** Shown as a badge in the top bar ("Staging", "Local"); empty on production. */
  environment: (import.meta.env.VITE_ENVIRONMENT as string | undefined) ?? (import.meta.env.DEV ? "Local" : ""),
  /**
   * Base map tiles: unset = OpenFreeMap (OpenStreetMap data, no key; self-host for production), a TileJSON URL for
   * your own tile server, or "off" for no base map (only the data layers, no network).
   */
  mapTiles: (import.meta.env.VITE_MAP_TILES as string | undefined) || null,
};

/**
 * The tiles RhoeMap gets: `null` (no base map, no network) under automation (Playwright sets navigator.webdriver),
 * with `?tiles=off`, or with VITE_MAP_TILES=off; `undefined` for the OpenFreeMap default; else your TileJSON URL.
 * `?tiles=on` forces them on in an automated browser.
 */
export function mapTiles(search = typeof location !== "undefined" ? location.search : ""): string | null | undefined {
  const asked = new URLSearchParams(search).get("tiles");
  if (asked === "off" || config.mapTiles === "off") return null;
  if (asked !== "on" && typeof navigator !== "undefined" && navigator.webdriver) return null;
  return config.mapTiles ?? undefined;
}
