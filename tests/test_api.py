import shutil

import pytest
from fastapi.testclient import TestClient

from atc_api import settings
from atc_api.main import app, store


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        yield c
    shutil.rmtree(settings.JOBS_DIR, ignore_errors=True)


def test_network_geojson(client):
    info = client.get('/api/network').json()
    edges = client.get('/api/network/edges')
    assert edges.status_code == 200 and len(edges.json()['features']) == info['edges']
    again = client.get('/api/network/edges', headers={'If-None-Match': edges.headers['etag']})
    assert again.status_code == 304


def test_analyze_needs_one_region_source(client):
    r = client.post('/api/perimeter/analyze', json={'preset': 'reference', 'region_a_edges': ['x']})
    assert r.status_code == 422 and r.json()['detail']['code'] == 'region-source'


def test_analyze_polygon(client):
    w, s, e, n = client.get('/api/network').json()['bbox']
    cx, cy, dx, dy = (w + e) / 2, (s + n) / 2, (e - w) / 8, (n - s) / 8
    ring = [[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy], [cx - dx, cy - dy]]
    r = client.post('/api/perimeter/analyze', json={'polygon': {'type': 'Polygon', 'coordinates': [ring]}})
    assert r.status_code == 200 and r.json()['region_edge_count'] > 0


def test_create_job_builds_the_trainer_command(client):
    region = client.get('/api/presets/reference').json()['region_a_edges']
    r = client.post('/api/training-jobs', json={
        'name': 'Reference perimeter', 'region_a_edges': region, 'demand_profile': 'aa_plus3000',
        'training': {'episodes': 3, 'generators': 2}})
    assert r.status_code == 201, r.text
    job = r.json()
    assert job['status'] == 'queued' and len(job['perimeter']['signals']) == 17
    cmd = store.command(store.get(job['_id']))
    assert cmd[cmd.index('--episodes') + 1] == '3' and '--perimeter' in cmd
    assert cmd[cmd.index('--extra-routes') + 1].endswith('extra_aa.rou.xml')
    assert client.post(f'/api/training-jobs/{job["_id"]}/cancel').json()['status'] == 'cancelled'
    assert client.post(f'/api/training-jobs/{job["_id"]}/cancel').status_code == 409


def test_create_job_rejects_invalid_perimeter(client):
    r = client.post('/api/training-jobs', json={'name': 'Nothing', 'region_a_edges': ['--30244#0']})
    assert r.status_code == 422 and r.json()['detail']['code'] == 'invalid-perimeter'
    r = client.post('/api/training-jobs', json={'name': 'Bad', 'region_a_edges': ['x'], 'training': {'duration': 100}})
    assert r.status_code == 422
