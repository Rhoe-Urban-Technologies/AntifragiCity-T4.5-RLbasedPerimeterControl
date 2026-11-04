"""Comparisons with fixed-time control: the job spec, the evaluator command and the results table."""
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from atc_api import settings
from atc_api.main import app, store
from shared_green_rl.evaluate import summarize


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as c:
        yield c
    shutil.rmtree(settings.JOBS_DIR, ignore_errors=True)


@pytest.fixture(scope='module')
def training(client):
    region = client.get('/api/presets/reference').json()['region_a_edges']
    job = client.post('/api/training-jobs', json={'name': 'Reference', 'region_a_edges': region,
                                                  'demand_profile': 'ba_plus3000_secondhalf'}).json()
    return job


def test_needs_a_trained_agent(client, training):
    r = client.post(f'/api/training-jobs/{training["_id"]}/comparisons', json={})
    assert r.status_code == 422 and 'no trained agent' in r.json()['detail']['message']
    # fixed time alone needs no agent
    r = client.post(f'/api/training-jobs/{training["_id"]}/comparisons', json={'include_agent': False})
    assert r.status_code == 201, r.text
    assert r.json()['spec']['controllers'] == ['fixed-10', 'fixed-32.5', 'fixed-55']


def test_defaults_follow_d45_and_the_training_job(client, training):
    run = store.folder(training['_id']) / 'run'
    run.mkdir(exist_ok=True)
    (run / 'agent.pt').write_bytes(b'not a real checkpoint')
    r = client.post(f'/api/training-jobs/{training["_id"]}/comparisons', json={'sumo_seeds': [43, 42, 42]})
    assert r.status_code == 201, r.text
    job = r.json()
    assert job['kind'] == 'comparison' and job['status'] == 'queued'
    assert job['spec']['fixed_budgets'] == [10, 32.5, 55]   # low, midpoint and high of the action range
    assert job['spec']['controllers'] == ['fixed-10', 'fixed-32.5', 'fixed-55', 'agent']
    assert job['spec']['sumo_seeds'] == [42, 43]
    assert job['spec']['demand_profile'] == 'ba_plus3000_secondhalf'
    assert job['progress']['runs_total'] == 8
    folder = store.folder(job['_id'])
    assert (folder / 'agent.pt').read_bytes() == b'not a real checkpoint'   # a snapshot
    cmd = store.command(store.get(job['_id']))
    assert cmd[cmd.index('-m') + 1] == 'shared_green_rl.evaluate'
    assert cmd[cmd.index('--fixed') + 1: cmd.index('--fixed') + 4] == ['10', '32.5', '55']
    assert cmd[cmd.index('--agent') + 1] == str(folder / 'agent.pt')
    assert cmd[cmd.index('--extra-routes') + 1].endswith('extra_ba.rou.xml')
    # comparisons are listed apart from training jobs
    assert all(j['kind'] == 'training' for j in client.get('/api/training-jobs').json()['items'])
    listed = client.get('/api/comparisons', params={'training_job': training['_id']}).json()
    assert job['_id'] in [j['_id'] for j in listed['items']]
    assert client.post(f'/api/comparisons/{job["_id"]}/cancel').json()['status'] == 'cancelled'


def test_rejects_budgets_outside_the_action_range(client, training):
    r = client.post(f'/api/training-jobs/{training["_id"]}/comparisons', json={'fixed_budgets': [5, 30]})
    assert r.status_code == 422 and 'action range 10–55 s' in r.json()['detail']['message']


def test_results_from_finished_runs(client, training):
    job = client.post(f'/api/training-jobs/{training["_id"]}/comparisons',
                      json={'fixed_budgets': [32.5], 'sumo_seeds': [1, 2]}).json()
    runs = store.folder(job['_id']) / 'run' / 'runs'
    runs.mkdir(parents=True)
    cycle = lambda ba, done: dict(time=28800, ba_seconds=ba, completed=done, tts=100, accumulation_a=10,
                                  accumulation_b=50)
    for controller, seed, completed, tts, ba in [('fixed-32.5', 1, 100, 1000, 32.5), ('fixed-32.5', 2, 110, 1100, 32.5),
                                                 ('agent', 1, 108, 990, 30), ('agent', 2, 112, 1000, 34)]:
        (runs / f'{controller}_seed{seed}.json').write_text(json.dumps(dict(
            controller=controller, sumo_seed=seed, completed=completed, tts=tts, elapsed_seconds=60,
            cycles=[cycle(ba, completed)])))
    body = client.get(f'/api/comparisons/{job["_id"]}').json()
    summary = {r['controller']: r for r in body['results']['summary']}
    assert summary['fixed-32.5']['completed'] == 105 and summary['agent']['completed'] == 110
    assert summary['agent']['tts_change'] == pytest.approx(995 / 1050 - 1)
    assert body['results']['cycles']['agent'][0]['ba_seconds'] == 32   # mean over the seeds
    assert body['progress']['runs_done'] == 4 and len(body['results']['runs']) == 4


def test_summary_compares_with_the_best_fixed_budget():
    runs = [dict(controller='fixed-10', completed=90, tts=200), dict(controller='fixed-55', completed=95, tts=150),
            dict(controller='agent', completed=100, tts=120)]
    rows = {r['controller']: r for r in summarize(runs, ['fixed-10', 'fixed-55', 'agent'])}
    assert rows['agent']['best_fixed'] == 'fixed-55'
    assert rows['agent']['tts_change'] == pytest.approx(-0.2)
    assert summarize([dict(controller='agent', completed=1, tts=1)], ['agent'])[0]['best_fixed'] is None
