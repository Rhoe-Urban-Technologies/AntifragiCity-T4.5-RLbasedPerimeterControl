"""FastAPI app for the ATC region and traffic-light selection UI.

Run from the repository root:  uvicorn atc_api.main:app --port 8000
Conventions follow @rhoe/data: lists are {items, total}, ids are `_id` strings, 422s use FastAPI's shape
or {"code", "message"} for errors the UI explains.
"""
from contextlib import asynccontextmanager
from functools import lru_cache
import json
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field
from shapely.geometry import shape

from atc_api import settings
from atc_api.jobs import DEMAND_PROFILES, JobCreate, JobStore, public
from atc_api.network import Network
from atc_api.perimeter import Analysis, LightOverride, analyze


@lru_cache(maxsize=1)
def network() -> Network:
    return Network(settings.NETWORK)


@lru_cache(maxsize=1)
def reference_region() -> list[str]:
    lines = settings.REGION_A.read_text(encoding='utf-8-sig').splitlines()
    return sorted(l.split(':', 1)[1].strip() for l in lines if l.startswith('edge:'))


store = JobStore()


@asynccontextmanager
async def lifespan(app: FastAPI):
    network()  # parse once at start-up, not on the first request
    store.start()
    yield
    store.stop()


app = FastAPI(title='SUMA ATC API', version='0.1.0', lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_methods=['*'], allow_headers=['*'])


def cached_json(request: Request, body: str, tag: str) -> Response:
    """Large, unchanging GeoJSON: an ETag so the browser revalidates instead of downloading it again."""
    etag = f'"{tag}"'
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers={'ETag': etag})
    return Response(body, media_type='application/geo+json', headers={'ETag': etag, 'Cache-Control': 'no-cache'})


@lru_cache(maxsize=2)
def _geojson(kind: str) -> str:
    net = network()
    return json.dumps(net.edges_geojson() if kind == 'edges' else net.lights_geojson(), separators=(',', ':'))


# network -----------------------------------------------------------------------------------------------------

@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.get('/api/network')
def network_info():
    net = network()
    w, s, e, n = net.bbox
    return {'_id': net.id, 'name': net.name, 'bbox': [w, s, e, n], 'edges': len(net.edges),
            'traffic_lights': len(net.lights), 'cycle_seconds': settings.CYCLE_SECONDS}


@app.get('/api/network/edges')
def network_edges(request: Request):
    return cached_json(request, _geojson('edges'), f'edges-{network().id}')


@app.get('/api/network/traffic-lights')
def network_lights(request: Request):
    return cached_json(request, _geojson('lights'), f'lights-{network().id}')


@app.get('/api/demand-profiles')
def demand_profiles():
    items = [p.model_dump(exclude={'option', 'path'}) | {'_id': p.id} for p in DEMAND_PROFILES]
    return {'items': items, 'total': len(items)}


# perimeter ---------------------------------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    """Give the region one way: a drawn polygon, a list of edges, or the reference Region A."""
    polygon: dict | None = Field(None, description='GeoJSON Polygon or MultiPolygon geometry in lon/lat')
    region_a_edges: list[str] | None = None
    preset: Literal['reference'] | None = None
    overrides: dict[str, LightOverride] = Field(default_factory=dict)
    min_green: float = Field(5, ge=1, le=30)


def region_from(req: AnalyzeRequest) -> set[str]:
    given = [x is not None for x in (req.polygon, req.region_a_edges, req.preset)]
    if sum(given) != 1:
        raise HTTPException(422, detail={'code': 'region-source',
                                         'message': 'Send exactly one of polygon, region_a_edges or preset.'})
    if req.preset == 'reference':
        return set(reference_region())
    if req.region_a_edges is not None:
        return set(req.region_a_edges)
    try:
        polygon = shape(req.polygon)
    except Exception:
        raise HTTPException(422, detail={'code': 'invalid-polygon', 'message': 'The region is not a valid GeoJSON polygon.'})
    if polygon.geom_type not in ('Polygon', 'MultiPolygon') or not polygon.is_valid or polygon.is_empty:
        raise HTTPException(422, detail={'code': 'invalid-polygon',
                                         'message': 'Draw a simple polygon: at least three points, edges not crossing.'})
    return network().edges_within(polygon)


@app.post('/api/perimeter/analyze', response_model=Analysis)
def perimeter_analyze(req: AnalyzeRequest):
    return analyze(network(), region_from(req), req.overrides, req.min_green)


@app.get('/api/presets/reference')
def preset_reference():
    """The Region A of the existing experiments (Region_A.txt) and its 17 boundary lights."""
    return {'_id': 'reference', 'name': 'Reference Region A', 'region_a_edges': reference_region()}


# training jobs -----------------------------------------------------------------------------------------------

@app.post('/api/training-jobs', status_code=201)
def create_job(spec: JobCreate):
    result = analyze(network(), set(spec.region_a_edges), spec.overrides, spec.training.min_green)
    if not result.valid:
        raise HTTPException(422, detail={'code': 'invalid-perimeter', 'message': ' '.join(result.errors) or
                                         'The selection has no controllable perimeter.'})
    summary = dict(region_edge_count=result.region_edge_count, region_length_km=result.region_length_km,
                   signals=[s.id for s in result.perimeter.signals], action_bounds=result.action_bounds,
                   crossings=result.crossings)
    job = store.create(spec, result.perimeter, summary)
    store.tick()  # start now if a slot is free
    return public(store.get(job['_id']), store)


@app.get('/api/training-jobs')
def list_jobs(status: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    jobs = [j for j in store.all() if status is None or j['status'] == status]
    items = [public(j, store) for j in jobs[(page - 1) * page_size: page * page_size]]
    return {'items': items, 'total': len(jobs)}


def _job_or_404(job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, 'Training job not found')
    return job


@app.get('/api/training-jobs/{job_id}')
def get_job(job_id: str):
    job = _job_or_404(job_id)
    return public(job, store) | {'rounds': store.rounds(job_id)}


@app.get('/api/training-jobs/{job_id}/perimeter')
def get_job_perimeter(job_id: str):
    _job_or_404(job_id)
    return json.loads((store.folder(job_id) / 'perimeter.json').read_text(encoding='utf-8'))


@app.get('/api/training-jobs/{job_id}/log')
def get_job_log(job_id: str, lines: int = Query(200, ge=1, le=2000)):
    _job_or_404(job_id)
    return {'lines': store.log_tail(job_id, lines)}


@app.post('/api/training-jobs/{job_id}/cancel')
def cancel_job(job_id: str):
    job = _job_or_404(job_id)
    if job['status'] not in ('queued', 'running'):
        raise HTTPException(409, detail={'code': 'not-active', 'message': f'The job is already {job["status"]}.'})
    return public(store.cancel(job_id), store)
