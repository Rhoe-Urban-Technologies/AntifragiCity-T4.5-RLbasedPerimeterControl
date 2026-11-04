// Polygon drawing on a RhoeMap: click to add a point, double-click (or Finish) to close the shape.
// It listens on the MapLibre instance through useMap(), so RhoeMap keeps its own click handling for the data layers.
// Keyboard and screen-reader users have the other region sources (reference region, current map view) beside the map.
import { useEffect, useMemo } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { useResolvedTheme } from "@rhoe/ui";
import { Layer, Source, mapPalette, useMap } from "@rhoe/ui/maps";
import { regionColor } from "./status";

export type LngLat = [number, number];

export function closeRing(points: LngLat[]): Polygon {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

interface DrawLayerProps {
  /** Adding points. */
  drawing: boolean;
  /** The points so far (while drawing). */
  draft: LngLat[];
  onAddPoint: (p: LngLat) => void;
  onFinish: () => void;
  /** The finished region, drawn as a filled outline. */
  polygon: Polygon | null;
}

export function DrawLayer({ drawing, draft, onAddPoint, onFinish, polygon }: DrawLayerProps) {
  const { current: map } = useMap();
  const palette = mapPalette(useResolvedTheme());

  useEffect(() => {
    if (!map || !drawing) return;
    const m = map.getMap();
    const click = (e: { lngLat: { lng: number; lat: number } }) => onAddPoint([e.lngLat.lng, e.lngLat.lat]);
    const dbl = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onFinish();
    };
    m.doubleClickZoom.disable();
    m.getCanvas().style.cursor = "crosshair";
    m.on("click", click);
    m.on("dblclick", dbl);
    return () => {
      m.off("click", click);
      m.off("dblclick", dbl);
      m.getCanvas().style.cursor = "";
      // re-enable after the double-click that finished the shape has passed
      setTimeout(() => m.doubleClickZoom.enable(), 300);
    };
  }, [map, drawing, onAddPoint, onFinish]);

  const data = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    if (drawing) {
      if (draft.length >= 3) features.push({ type: "Feature", properties: { kind: "area" }, geometry: closeRing(draft) });
      if (draft.length >= 2) features.push({ type: "Feature", properties: { kind: "edge" }, geometry: { type: "LineString", coordinates: draft } });
      draft.forEach((p, i) => features.push({ type: "Feature", properties: { kind: "vertex", first: i === 0 }, geometry: { type: "Point", coordinates: p } }));
    } else if (polygon) {
      features.push({ type: "Feature", properties: { kind: "area" }, geometry: polygon });
    }
    return { type: "FeatureCollection", features };
  }, [drawing, draft, polygon]);

  const accent = regionColor(palette);
  return (
    <Source id="atc-draw" type="geojson" data={data}>
      <Layer id="atc-draw-fill" type="fill" filter={["==", ["get", "kind"], "area"]} paint={{ "fill-color": accent, "fill-opacity": 0.08 }} />
      <Layer
        id="atc-draw-outline"
        type="line"
        filter={["in", ["get", "kind"], ["literal", ["area", "edge"]]]}
        layout={{ "line-join": "round" }}
        paint={{ "line-color": palette.text, "line-width": 2, "line-dasharray": [2, 1.5] }}
      />
      <Layer
        id="atc-draw-vertex"
        type="circle"
        filter={["==", ["get", "kind"], "vertex"]}
        paint={{
          "circle-radius": ["case", ["get", "first"], 6, 4],
          "circle-color": palette.surface,
          "circle-stroke-color": palette.text,
          "circle-stroke-width": 2,
        }}
      />
    </Source>
  );
}
