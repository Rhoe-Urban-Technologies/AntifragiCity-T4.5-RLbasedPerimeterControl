"""The SUMO network as the API needs it: edge and light geometry in longitude/latitude, and light links.

Parsed once per process (the LuST network takes well under a second). Coordinates follow SUMO's
`<location>`: network x/y minus `netOffset` gives projected coordinates in `projParameter`.
"""
from dataclasses import dataclass, field
from functools import cached_property
import xml.etree.ElementTree as ET
from pathlib import Path

from pyproj import CRS, Transformer
from shapely.geometry import LineString, Point


@dataclass
class Edge:
    id: str
    from_node: str
    to_node: str
    lanes: int
    speed: float
    length: float
    type: str
    xy: list[tuple[float, float]]          # network coordinates (metres)
    lonlat: list[tuple[float, float]] = field(default_factory=list)

    @cached_property
    def midpoint_lonlat(self) -> tuple[float, float]:
        p = LineString(self.lonlat).interpolate(0.5, normalized=True)
        return p.x, p.y


@dataclass
class Phase:
    index: int
    state: str
    duration: float

    @property
    def is_green(self) -> bool:
        # Same rule as shared_green_rl.signals: a phase with an uppercase G is a green service phase.
        return 'G' in self.state


@dataclass
class TrafficLight:
    id: str
    phases: list[Phase]
    #: linkIndex -> {(from_edge, to_edge)} for the external edges each signal link joins
    links: dict[int, set[tuple[str, str]]]
    lonlat: tuple[float, float]


class Network:
    def __init__(self, path: Path, network_id: str = 'lust', name: str = 'Luxembourg (LuST)'):
        self.path, self.id, self.name = Path(path), network_id, name
        root = ET.parse(self.path).getroot()
        location = root.find('location')
        ox, oy = (float(v) for v in location.get('netOffset').split(','))
        to_lonlat = Transformer.from_crs(CRS.from_proj4(location.get('projParameter')), 'EPSG:4326', always_xy=True)

        def convert(points):
            xs, ys = zip(*points)
            lons, lats = to_lonlat.transform([x - ox for x in xs], [y - oy for y in ys])
            return [(round(lon, 6), round(lat, 6)) for lon, lat in zip(lons, lats)]

        def parse_shape(text):
            return [tuple(float(v) for v in p.split(',')[:2]) for p in text.split()]

        junctions = {j.get('id'): (float(j.get('x')), float(j.get('y'))) for j in root.findall('junction')}
        self.edges: dict[str, Edge] = {}
        for e in root.findall('edge'):
            if e.get('function') == 'internal':
                continue
            lanes = e.findall('lane')
            shape = e.get('shape') or lanes[0].get('shape')
            edge = Edge(id=e.get('id'), from_node=e.get('from'), to_node=e.get('to'), lanes=len(lanes),
                        speed=max(float(l.get('speed')) for l in lanes),
                        length=float(lanes[0].get('length')), type=e.get('type') or '', xy=parse_shape(shape))
            edge.lonlat = convert(edge.xy)
            self.edges[edge.id] = edge

        links: dict[str, dict[int, set]] = {}
        #: every movement between external edges: (from_edge, to_edge) -> controlling light id or None
        self.movements: dict[tuple[str, str], str | None] = {}
        for c in root.findall('connection'):
            tl, pair = c.get('tl'), (c.get('from'), c.get('to'))
            if pair[0] not in self.edges or pair[1] not in self.edges:
                continue
            if tl:
                links.setdefault(tl, {}).setdefault(int(c.get('linkIndex')), set()).add(pair)
            if self.movements.get(pair) is None:
                self.movements[pair] = tl

        self.lights: dict[str, TrafficLight] = {}
        for t in root.findall('tlLogic'):
            tl = t.get('id')
            if tl in self.lights:
                continue  # the first program per light, as the trainer uses
            phases = [Phase(i, p.get('state'), float(p.get('duration'))) for i, p in enumerate(t.findall('phase'))]
            tl_links = links.get(tl, {})
            if tl in junctions:
                xy = junctions[tl]
            else:  # a joined light: the centre of the junctions its incoming edges end at
                ends = [junctions[self.edges[f].to_node] for s in tl_links.values() for f, _ in s]
                xy = (sum(p[0] for p in ends) / len(ends), sum(p[1] for p in ends) / len(ends)) if ends else (ox, oy)
            self.lights[tl] = TrafficLight(tl, phases, tl_links, convert([xy])[0])

        lons = [p[0] for e in self.edges.values() for p in e.lonlat]
        lats = [p[1] for e in self.edges.values() for p in e.lonlat]
        self.bbox = (min(lons), min(lats), max(lons), max(lats))

    def edges_within(self, polygon) -> set[str]:
        """Edges whose midpoint lies inside a shapely polygon in lon/lat."""
        return {e.id for e in self.edges.values() if polygon.contains(Point(e.midpoint_lonlat))}

    # GeoJSON for the map ------------------------------------------------------------------------------------

    def edges_geojson(self) -> dict:
        return {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': e.id,
             'geometry': {'type': 'LineString', 'coordinates': e.lonlat},
             'properties': {'id': e.id, 'lanes': e.lanes, 'speed': e.speed, 'type': e.type}}
            for e in self.edges.values()]}

    def lights_geojson(self) -> dict:
        return {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': f'tls:{l.id}',
             'geometry': {'type': 'Point', 'coordinates': l.lonlat},
             'properties': {'id': l.id, 'phases': len(l.phases), 'links': len(l.links)}}
            for l in self.lights.values()]}
