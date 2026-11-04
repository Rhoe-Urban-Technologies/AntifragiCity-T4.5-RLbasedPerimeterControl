/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MAINTENANCE?: string;
  readonly VITE_ENVIRONMENT?: string;
  readonly VITE_MAP_TILES?: string;
}
