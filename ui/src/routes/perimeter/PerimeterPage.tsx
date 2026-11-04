// Perimeter & training: choose Region A on the map (draw it, take the map view, or start from the reference region),
// review the boundary traffic lights the API finds and how each green phase is classified, adjust them, and start a
// training job. Every change re-runs POST /perimeter/analyze; the server is the one source of truth for the
// perimeter, the action bounds and whether the selection can be trained. Lazy-loaded (MapLibre).
import "@rhoe/ui/maplibre.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Feature, Polygon } from "geojson";
import { Check, Crosshair, Pencil, Play, RotateCcw, Scan, Undo2, X } from "lucide-react";
import { Button, Card, CardHeader, ErrorState, Icon, NumberField, PageHeader, Skeleton, StatusPill, useResolvedTheme } from "@rhoe/ui";
import {
  LayerToggle,
  LineLayer,
  MapFrame,
  MapLegend,
  PointLayer,
  RhoeMap,
  featureCollection,
  mapPalette,
  type Bbox,
  type FeatureId,
  type MapListItem,
  type MapStatus,
} from "@rhoe/ui/maps";
import { jobsApi, useAnalysis, useNetworkEdges, useNetworkInfo, useNetworkLights } from "../../api/queries";
import type { AnalyzeRequest, LightOverride, Overrides, RegionSource } from "../../api/types";
import { mapTiles } from "../../config";
import { useLocale } from "../../i18n";
import { usePage } from "../../app/page";
import { DrawLayer, closeRing, type LngLat } from "./DrawLayer";
import { LightPanel } from "./LightPanel";
import { TrainingDrawer } from "./TrainingDrawer";
import { LIGHT_MAP_STATUS, LIGHT_STATUSES, regionColor, lightFeatureId, lightIdOf } from "./status";

const LAYERS = ["region", "roads", "lights", "otherLights"] as const;
type LayerId = (typeof LAYERS)[number];

function bboxPolygon([w, s, e, n]: Bbox, inset = 0.08): Polygon {
  const dx = (e - w) * inset;
  const dy = (n - s) * inset;
  return closeRing([
    [w + dx, s + dy],
    [e - dx, s + dy],
    [e - dx, n - dy],
    [w + dx, n - dy],
  ]);
}

export function PerimeterPage() {
  const { t, fmt } = useLocale();
  usePage(t.perimeter.title);
  const [params, setParams] = useSearchParams();
  const fromJob = params.get("from");

  const info = useNetworkInfo();
  const edges = useNetworkEdges();
  const allLights = useNetworkLights();

  const [region, setRegion] = useState<RegionSource | null>({ preset: "reference" });
  const [overrides, setOverrides] = useState<Overrides>({});
  const [minGreen, setMinGreen] = useState(5);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [selected, setSelected] = useState<FeatureId | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [layers, setLayers] = useState<string[]>(["region", "roads", "lights"]);
  const [configOpen, setConfigOpen] = useState(false);
  const [tiles] = useState(() => mapTiles());
  const visible = (id: LayerId) => layers.includes(id);

  // ?from=<job id>: start from a job's selection ("Use as a starting point" on the job page)
  useEffect(() => {
    if (!fromJob) return;
    let gone = false;
    void jobsApi.get(fromJob).then((job) => {
      if (gone) return;
      setRegion({ region_a_edges: job.spec.region_a_edges });
      setOverrides(job.spec.overrides ?? {});
      setMinGreen(job.spec.training.min_green);
      setParams({}, { replace: true });
    });
    return () => {
      gone = true;
    };
  }, [fromJob, setParams]);

  const request: AnalyzeRequest | null = region ? { ...region, overrides, min_green: minGreen } : null;
  const analysis = useAnalysis(request);
  const a = analysis.data;

  const newRegion = (next: RegionSource | null) => {
    setRegion(next);
    setOverrides({});
    setSelected(null);
  };

  // drawing. The points live in a ref too: a double-click sends two clicks and then dblclick before React
  // re-renders, and finishing must see all of them.
  const draftRef = useRef<LngLat[]>([]);
  const updateDraft = useCallback((next: LngLat[]) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const addPoint = useCallback((p: LngLat) => updateDraft([...draftRef.current, p]), [updateDraft]);
  const undoPoint = useCallback(() => updateDraft(draftRef.current.slice(0, -1)), [updateDraft]);
  const finish = useCallback(() => {
    const points = draftRef.current.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
    if (points.length < 3) return;
    setRegion({ polygon: closeRing(points) });
    setOverrides({});
    setSelected(null);
    setDrawing(false);
    updateDraft([]);
  }, [updateDraft]);
  const startDrawing = () => {
    updateDraft([]);
    setDrawing(true);
    setSelected(null);
  };
  useEffect(() => {
    if (!drawing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawing(false);
      if (e.key === "Enter") finish();
      if (e.key === "Backspace" && !(e.target instanceof HTMLInputElement)) undoPoint();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drawing, finish, undoPoint]);

  // map data
  const theme = useResolvedTheme();
  const palette = mapPalette(theme);
  const regionLine = useMemo(() => regionColor(mapPalette(theme)), [theme]); // the tokens change with the theme
  const inA = useMemo(() => new Set(a?.region_a_edges ?? []), [a?.region_a_edges]);
  const edgesA = useMemo(() => ({ type: "FeatureCollection" as const, features: (edges.data?.features ?? []).filter((f) => inA.has(String(f.id))) }), [edges.data, inA]);
  const edgesB = useMemo(() => ({ type: "FeatureCollection" as const, features: (edges.data?.features ?? []).filter((f) => !inA.has(String(f.id))) }), [edges.data, inA]);
  const perimeterLights = a?.lights ?? [];
  const lightById = useMemo(() => new Map(perimeterLights.map((l) => [l.id, l])), [perimeterLights]);
  const lightFc = useMemo(
    () =>
      featureCollection(perimeterLights, (l) => ({ type: "Point", coordinates: l.location }), {
        id: (l) => lightFeatureId(l.id),
        properties: (l) => ({ name: t.light.title(l.id), status: LIGHT_MAP_STATUS[l.status] }),
      }),
    [perimeterLights, t],
  );
  const otherLights = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (allLights.data?.features ?? []).filter((f) => !lightById.has(f.properties.id)),
    }),
    [allLights.data, lightById],
  );
  const status$ = useCallback((f: Feature) => f.properties?.status as MapStatus, []);
  const polygon = region && "polygon" in region ? region.polygon : null;
  const selectedLight = lightById.get(lightIdOf(selected) ?? "") ?? null;
  const setOverride = (id: string, next: LightOverride | undefined) =>
    setOverrides((o) => {
      const copy = { ...o };
      if (!next || (next.include == null && !Object.keys(next.roles ?? {}).length)) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  const counts = { ok: 0, warning: 0, error: 0, excluded: 0 };
  perimeterLights.forEach((l) => counts[l.status]++);
  const included = counts.ok + counts.warning;

  const listItems: MapListItem[] = perimeterLights.map((l) => ({
    id: lightFeatureId(l.id),
    label: t.light.title(l.id),
    status: LIGHT_MAP_STATUS[l.status],
    values: { in: l.crossings_in, out: l.crossings_out, phases: l.phases.filter((p) => p.green).length, included: l.included ? t.common.yes : t.common.no },
  }));

  const regionLabel = !region
    ? t.perimeter.noRegion
    : "preset" in region
      ? t.perimeter.sourceReference
      : "polygon" in region
        ? t.perimeter.sourceDrawn
        : t.perimeter.sourceEdges;

  const initialView = info.data ? { bounds: info.data.bbox, fitBoundsOptions: { padding: 16 } } : undefined;
  const loadingNetwork = info.isLoading || edges.isLoading;

  return (
    <div className="app-stack">
      <PageHeader
        title={t.perimeter.title}
        description={t.perimeter.description}
        actions={
          <Button variant="primary" iconStart={<Icon icon={Play} />} isDisabled={!a?.valid || analysis.isPlaceholderData} onPress={() => setConfigOpen(true)}>
            {t.perimeter.configure}
          </Button>
        }
      />

      {(info.isError || edges.isError) && (
        <ErrorState title={t.perimeter.networkFailed} error={info.error ?? edges.error} onRetry={() => void (info.refetch(), edges.refetch())} headingLevel={2} />
      )}

      <div className="atc-layout">
        <div className="atc-map" aria-busy={loadingNetwork || undefined}>
          {loadingNetwork || !initialView ? (
            <Skeleton height={620} />
          ) : (
            <MapFrame
              title={info.data!.name}
              headingLevel={2}
              description={
                <span role="status">
                  {drawing ? t.perimeter.drawingStatus(draft.length) : a ? t.perimeter.mapStatus(a.region_edge_count, included) : t.common.loading}
                  {analysis.isFetching && !drawing ? ` · ${t.perimeter.updating}` : ""}
                </span>
              }
              selectedId={selected}
              onSelect={(id) => !drawing && setSelected(id)}
              list={{
                items: listItems,
                columns: [
                  { key: "in", label: t.light.colIn, numeric: true },
                  { key: "out", label: t.light.colOut, numeric: true },
                  { key: "phases", label: t.light.colPhases, numeric: true },
                  { key: "included", label: t.light.colIncluded },
                ],
              }}
              messages={{ statusLabels: { success: t.light.status.ok, warning: t.light.status.warning, danger: t.light.status.error, neutral: t.light.status.excluded } }}
              aside={
                <div className="app-map-aside">
                  <LayerToggle
                    label={t.perimeter.layers}
                    layers={[
                      { id: "region", label: t.perimeter.layerRegion, swatch: { kind: "line", color: regionLine } },
                      { id: "roads", label: t.perimeter.layerRoads, swatch: { kind: "line", color: palette.textMuted } },
                      { id: "lights", label: t.perimeter.layerLights, description: t.perimeter.lightsCount(perimeterLights.length) },
                      { id: "otherLights", label: t.perimeter.layerOtherLights, swatch: { kind: "point", color: palette.textMuted } },
                    ]}
                    value={layers}
                    onChange={(v) => setLayers(LAYERS.filter((id) => v.includes(id)))}
                  />
                  <MapLegend
                    title={t.perimeter.legend}
                    statuses={visible("lights") ? LIGHT_STATUSES : []}
                    items={[
                      ...(visible("region") ? [{ label: t.perimeter.legendA, kind: "line" as const, color: regionLine }] : []),
                      ...(visible("roads") ? [{ label: t.perimeter.legendB, kind: "line" as const, color: palette.textMuted }] : []),
                    ]}
                  />
                </div>
              }
              footnote={
                <>
                  {t.perimeter.footnote}
                  {tiles === null && ` ${t.perimeter.tilesOff}`}
                </>
              }
            >
              <RhoeMap label={t.perimeter.mapLabel} workerUrl={workerUrl} tiles={tiles} initialViewState={initialView} onBoundsChange={setBbox} height={620}>
                <LineLayer id="roads-b" data={edgesB} color={palette.textMuted} width={1.2} casing={false} selectable={false} visible={visible("roads")} />
                <LineLayer id="roads-a" data={edgesA} color={regionLine} width={2.5} casing={false} selectable={false} visible={visible("region")} />
                <DrawLayer drawing={drawing} draft={draft} onAddPoint={addPoint} onFinish={finish} polygon={polygon} />
                <PointLayer id="other-lights" data={otherLights} shape="circle" color={palette.textMuted} size={8} selectable={false} visible={visible("otherLights")} />
                <PointLayer id="lights" data={lightFc} status={status$} size={20} selectable={!drawing} visible={visible("lights")} />
              </RhoeMap>
            </MapFrame>
          )}
        </div>

        <div className="atc-panel">
          <Card>
            <CardHeader level={2} title={t.perimeter.regionTitle} description={regionLabel} />
            <div className="app-stack atc-gap-4">
              {drawing ? (
                <>
                  <p className="app-muted">{t.perimeter.drawHelp}</p>
                  <div className="atc-buttons">
                    <Button size="sm" variant="primary" iconStart={<Icon icon={Check} size="sm" />} isDisabled={draft.length < 3} onPress={finish}>
                      {t.perimeter.finish(draft.length)}
                    </Button>
                    <Button size="sm" iconStart={<Icon icon={Undo2} size="sm" />} isDisabled={!draft.length} onPress={undoPoint}>
                      {t.perimeter.undo}
                    </Button>
                    <Button size="sm" variant="ghost" iconStart={<Icon icon={X} size="sm" />} onPress={() => setDrawing(false)}>
                      {t.common.cancel}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="atc-buttons">
                  <Button size="sm" iconStart={<Icon icon={Pencil} size="sm" />} onPress={startDrawing}>
                    {t.perimeter.draw}
                  </Button>
                  <Button size="sm" iconStart={<Icon icon={Scan} size="sm" />} isDisabled={!bbox} onPress={() => bbox && newRegion({ polygon: bboxPolygon(bbox) })}>
                    {t.perimeter.useView}
                  </Button>
                  <Button size="sm" variant="ghost" iconStart={<Icon icon={RotateCcw} size="sm" />} onPress={() => newRegion({ preset: "reference" })}>
                    {t.perimeter.reference}
                  </Button>
                </div>
              )}
              {a && (
                <dl className="app-facts">
                  <div>
                    <dt>{t.perimeter.edges}</dt>
                    <dd>{fmt.number(a.region_edge_count)}</dd>
                  </div>
                  <div>
                    <dt>{t.perimeter.length}</dt>
                    <dd>{t.common.km(fmt.number(a.region_length_km))}</dd>
                  </div>
                </dl>
              )}
            </div>
          </Card>

          {selectedLight ? (
            <LightPanel light={selectedLight} override={overrides[selectedLight.id]} onChange={(o) => setOverride(selectedLight.id, o)} onClose={() => setSelected(null)} />
          ) : (
            <Card>
              <CardHeader
                level={2}
                title={t.perimeter.perimeterTitle}
                description={a ? (a.valid ? <StatusPill tone="success">{t.perimeter.ready}</StatusPill> : <StatusPill tone="danger">{t.perimeter.notReady}</StatusPill>) : undefined}
              />
              {analysis.isError && !a ? (
                <ErrorState title={t.perimeter.analysisFailed} error={analysis.error} onRetry={() => void analysis.refetch()} headingLevel={3} />
              ) : !a ? (
                <Skeleton lines={5} />
              ) : (
                <div className="app-stack atc-gap-4">
                  <dl className="app-facts">
                    <div>
                      <dt>{t.perimeter.lightsIncluded}</dt>
                      <dd>{t.perimeter.ofLights(included, perimeterLights.length)}</dd>
                    </div>
                    <div>
                      <dt>{t.perimeter.actionBounds}</dt>
                      <dd>{a.action_bounds ? t.common.range(fmt.number(a.action_bounds[0]), fmt.number(a.action_bounds[1])) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t.perimeter.controlled}</dt>
                      <dd>{fmt.number(a.crossings.controlled)}</dd>
                    </div>
                    <div>
                      <dt>{t.perimeter.uncontrolled}</dt>
                      <dd>{fmt.number(a.crossings.other_lights + a.crossings.unsignalised)}</dd>
                    </div>
                  </dl>
                  <ul className="atc-counts" aria-label={t.perimeter.byStatus}>
                    {(["ok", "warning", "error", "excluded"] as const).map((k) => (
                      <li key={k}>
                        <StatusPill tone={k === "ok" ? "success" : k === "warning" ? "warning" : k === "error" ? "danger" : "neutral"}>{t.light.status[k]}</StatusPill>
                        <span className="atc-count">{fmt.number(counts[k])}</span>
                      </li>
                    ))}
                  </ul>
                  {a.errors.length > 0 && (
                    <ul className="atc-messages" aria-label={t.perimeter.problems}>
                      {a.errors.map((e) => (
                        <li key={e} data-tone="danger">
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                  <NumberField
                    label={t.perimeter.minGreen}
                    description={t.perimeter.minGreenHint}
                    value={minGreen}
                    onChange={(v) => setMinGreen(Number.isNaN(v) ? 5 : v)}
                    minValue={1}
                    maxValue={30}
                    size="sm"
                  />
                  <p className="app-muted">
                    <Icon icon={Crosshair} size="sm" /> {t.perimeter.selectHint}
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {a?.valid && (
        <TrainingDrawer isOpen={configOpen} onOpenChange={setConfigOpen} analysis={a} overrides={overrides} minGreen={minGreen} />
      )}
    </div>
  );
}

export default PerimeterPage;
