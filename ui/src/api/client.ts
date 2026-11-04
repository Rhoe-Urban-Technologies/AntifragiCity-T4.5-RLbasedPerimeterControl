// One API client for the app: the ATC FastAPI (atc_api). In development Vite proxies /api to it (vite.config.ts).
import { createApiClient, isApiError } from "@rhoe/data";
import { config } from "../config";

let language = "en";
/** The UI language, sent as Accept-Language. */
export const setApiLanguage = (lang: string) => {
  language = lang;
};

export const api = createApiClient({
  baseUrl: config.apiUrl,
  headers: () => ({ "Accept-Language": language }),
  // dates stay ISO strings: the pages format them with the locale's formatters
  reviveDates: false,
});

/** A not-found error from the API (404). */
export const isNotFound = (error: unknown) => isApiError(error) && error.status === 404;
