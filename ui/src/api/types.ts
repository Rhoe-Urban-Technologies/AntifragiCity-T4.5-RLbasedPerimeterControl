// The ATC API's shapes (atc_api/*.py). Hand-written for the sample; generate them from /openapi.json once the API
// settles (see "Typed clients" in the @rhoe/data README).
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";

export interface NetworkInfo {
  id: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  edges: number;
  traffic_lights: number;
  cycle_seconds: number;
}

export type EdgeCollection = FeatureCollection<LineString, { id: string; lanes: number; speed: number; type: string }>;
export type LightCollection = FeatureCollection<Point, { id: string; phases: number; links: number }>;

export type PhaseRole = "ba" | "ab" | "fixed";
export type DetectedRole = "ba" | "ab" | "mixed" | "none";
export type LightStatus = "ok" | "warning" | "error" | "excluded";

export interface LightOverride {
  include?: boolean | null;
  /** phase index -> role, for green phases */
  roles?: Record<string, PhaseRole>;
}
export type Overrides = Record<string, LightOverride>;

export interface PhaseReport {
  index: number;
  state: string;
  duration: number;
  green: boolean;
  detected: DetectedRole | null;
  role: PhaseRole;
  overridden: boolean;
}

export interface LightReport {
  id: string;
  /** [lon, lat] */
  location: [number, number];
  crossings_in: number;
  crossings_out: number;
  included: boolean;
  status: LightStatus;
  messages: string[];
  phases: PhaseReport[];
  green_budget: number;
  bounds: [number, number] | null;
}

export interface PerimeterSpec {
  version: number;
  network: string;
  region_a_edges: string[];
  signals: Array<{ id: string; ba_phases: number[]; ab_phases: number[] }>;
}

export interface Analysis {
  region_a_edges: string[];
  region_edge_count: number;
  region_length_km: number;
  lights: LightReport[];
  crossings: { controlled: number; other_lights: number; unsignalised: number };
  action_bounds: [number, number] | null;
  min_green: number;
  valid: boolean;
  errors: string[];
  perimeter: PerimeterSpec | null;
}

/** Exactly one region source. */
export type RegionSource = { preset: "reference" } | { polygon: Polygon } | { region_a_edges: string[] };

export interface AnalyzeRequest {
  preset?: "reference";
  polygon?: Polygon;
  region_a_edges?: string[];
  overrides: Overrides;
  min_green: number;
}

export interface DemandProfile {
  id: string;
  _id: string;
  name: string;
  description: string;
  trips_08_09: number;
}

export interface TrainingSettings {
  episodes: number;
  generators: number;
  min_green: number;
  noise: number;
  seed: number;
  sumo_seed: number;
  exploration_seed: number;
  begin: number;
  duration: number;
  train_sample_size: number;
  critic_epochs: number;
  critic_batch_size: number;
  critic_validation_fraction: number;
  critic_patience: number;
  actor_steps: number;
  target_update_period: number;
}

export interface JobCreate {
  name: string;
  region_a_edges: string[];
  overrides: Overrides;
  demand_profile: string;
  training: TrainingSettings;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TrainingRound {
  episode: number;
  mean_reward: number | null;
  mean_tts: number | null;
  mean_completed: number | null;
  mean_completion_rate: number | null;
  critic_loss: number | null;
  actor_loss: number | null;
  elapsed_seconds: number | null;
}

export interface TrainingJob {
  id: string;
  _id: string;
  name: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  error: string | null;
  return_code: number | null;
  /** The demand profile's display name. */
  demand_profile: string;
  spec: JobCreate;
  perimeter: {
    region_edge_count: number;
    region_length_km: number;
    signals: string[];
    action_bounds: [number, number];
    crossings: Analysis["crossings"];
  };
  progress: {
    rounds_done: number;
    rounds_total: number;
    fraction: number;
    eta_seconds: number | null;
    current: { episode: number; simulations_done: number; simulations: number } | null;
  };
  /** Only on GET /training-jobs/:id */
  rounds?: TrainingRound[];
}

export interface ListPage<T> {
  items: T[];
  total: number;
}
