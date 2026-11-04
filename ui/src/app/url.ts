// URL state through React Router, for @rhoe/ui's useFilterState and @rhoe/data's useUrlListParams.
// (Their default adapters write window.history directly, which a data router doesn't see.)
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { FilterUrlAdapter } from "@rhoe/ui";
import type { UrlAdapter } from "@rhoe/data";

export function useRouterFilterAdapter(): FilterUrlAdapter {
  const [params, setParams] = useSearchParams();
  return useMemo(() => ({ get: () => params, set: (next) => setParams(next, { replace: true, preventScrollReset: true }) }), [params, setParams]);
}

export function useRouterListAdapter(): UrlAdapter {
  const [params, setParams] = useSearchParams();
  return useMemo(
    () => ({
      getSearch: () => params.toString(),
      setSearch: (search, mode) => setParams(search, { replace: mode === "replace", preventScrollReset: true }),
      subscribe: () => () => {}, // the router re-renders on navigation
    }),
    [params, setParams],
  );
}
