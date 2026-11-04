// Query keys, fetchers and hooks: one place per resource, so pages stay small.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createKeys } from "@rhoe/data";
import { api } from "./client";
import type {
  Analysis,
  AnalyzeRequest,
  DemandProfile,
  EdgeCollection,
  JobCreate,
  LightCollection,
  ListPage,
  NetworkInfo,
  TrainingJob,
} from "./types";

export const networkKeys = createKeys("network");
export const perimeterKeys = createKeys("perimeter");
export const jobKeys = createKeys("training-jobs");

const ACTIVE = new Set(["queued", "running"]);

export const networkApi = {
  info: (signal?: AbortSignal) => api.get<NetworkInfo>("/network", { signal }),
  // big and unchanging: the API sends an ETag, so revisits revalidate instead of downloading again
  edges: (signal?: AbortSignal) => api.get<EdgeCollection>("/network/edges", { signal, normalizeIds: false }),
  lights: (signal?: AbortSignal) => api.get<LightCollection>("/network/traffic-lights", { signal, normalizeIds: false }),
  demandProfiles: (signal?: AbortSignal) => api.get<ListPage<DemandProfile>>("/demand-profiles", { signal }),
  reference: (signal?: AbortSignal) => api.get<{ region_a_edges: string[] }>("/presets/reference", { signal }),
};

export const perimeterApi = {
  analyze: (body: AnalyzeRequest, signal?: AbortSignal) => api.post<Analysis>("/perimeter/analyze", { body, signal }),
};

export const jobsApi = {
  list: (signal?: AbortSignal) => api.get<ListPage<TrainingJob>>("/training-jobs", { query: { page_size: 100 }, signal }),
  get: (id: string, signal?: AbortSignal) => api.get<TrainingJob>(`/training-jobs/${id}`, { signal }),
  log: (id: string, signal?: AbortSignal) => api.get<{ lines: string[] }>(`/training-jobs/${id}/log`, { query: { lines: 400 }, signal }),
  create: (body: JobCreate) => api.post<TrainingJob>("/training-jobs", { body }),
  cancel: (id: string) => api.post<TrainingJob>(`/training-jobs/${id}/cancel`),
};

const forever = { staleTime: Infinity, gcTime: Infinity } as const;

export const useNetworkInfo = () => useQuery({ queryKey: networkKeys.detail("info"), queryFn: ({ signal }) => networkApi.info(signal), ...forever });
export const useNetworkEdges = () => useQuery({ queryKey: networkKeys.detail("edges"), queryFn: ({ signal }) => networkApi.edges(signal), ...forever });
export const useNetworkLights = () => useQuery({ queryKey: networkKeys.detail("lights"), queryFn: ({ signal }) => networkApi.lights(signal), ...forever });
export const useDemandProfiles = () => useQuery({ queryKey: networkKeys.detail("demand"), queryFn: ({ signal }) => networkApi.demandProfiles(signal), ...forever });

/** The perimeter for a region and the user's light choices. Keeps showing the last result while the next loads. */
export function useAnalysis(request: AnalyzeRequest | null) {
  return useQuery({
    queryKey: perimeterKeys.detail(JSON.stringify(request)),
    queryFn: ({ signal }) => perimeterApi.analyze(request!, signal),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

/** Polls every 5 s while any job is queued or running. */
export const useJobs = () =>
  useQuery({
    queryKey: jobKeys.lists(),
    queryFn: ({ signal }) => jobsApi.list(signal),
    refetchInterval: (q) => (q.state.data?.items.some((j) => ACTIVE.has(j.status)) ? 5000 : false),
  });

export const useJob = (id: string) =>
  useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) => jobsApi.get(id, signal),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 3000 : false),
  });

export const useJobLog = (id: string, active: boolean) =>
  useQuery({ queryKey: [...jobKeys.detail(id), "log"], queryFn: ({ signal }) => jobsApi.log(id, signal), refetchInterval: active ? 3000 : false });
