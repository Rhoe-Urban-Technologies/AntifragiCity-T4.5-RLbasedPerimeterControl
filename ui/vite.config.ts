import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";

// build options from the environment (typed here, so the app needs no @types/node)
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

// @antifragicity/theme is linked from a sibling antifragicity-ui checkout (it isn't published yet; see README).
// The link resolves to that folder, so the dev server must be allowed to serve it, and the theme's font packages
// come from this app's node_modules.
const THEME = new URL("../../antifragicity-ui/packages/theme", import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  base: env.BASE ?? "/",
  resolve: { dedupe: ["@fontsource/archivo", "@fontsource/source-sans-3"] },
  // /api goes to the ATC FastAPI (uvicorn atc_api.main:app --port 8000), so the browser needs no CORS
  server: { port: 5180, fs: { allow: [searchForWorkspaceRoot(env.PWD ?? "."), THEME] }, proxy: { "/api": env.ATC_API ?? "http://localhost:8000" } },
  preview: { port: 5181, proxy: { "/api": env.ATC_API ?? "http://localhost:8000" } },
  // MapLibre (1.1 MB) is the largest chunk; it loads only with the perimeter page
  build: { sourcemap: env.SOURCEMAP !== "false", chunkSizeWarningLimit: 1200 },
  // The map peers are imported by a lazy page through @rhoe/ui: pre-bundle them, or the dev server finds them on
  // the first visit, re-optimises and reloads the page.
  optimizeDeps: { include: ["react-map-gl/maplibre", "maplibre-gl"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 20_000,
    // run @rhoe/ui through Vite, so vi.mock("react-map-gl/maplibre") also reaches its imports
    server: { deps: { inline: [/@rhoe\/ui/, /@antifragicity\/theme/, /antifragicity-ui/] } },
  },
});
