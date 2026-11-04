"""Jobs: a spec saved on disk and the real trainer (or evaluator) run as a local background process.

Two kinds share one queue, so they never compete for the CPU:

- training: `shared_green_rl.train_parallel` for a perimeter;
- comparison: `shared_green_rl.evaluate`, a trained agent against fixed-time control (D4.5, section 5.1) on the
  same demand and SUMO seeds.

This is the stand-in for the SUMA orchestrator: the specs (`JobCreate`, `ComparisonCreate`) are the contract it will
accept later, and the folder layout maps onto tables (training_jobs, training_rounds, comparisons,
comparison_runs) when jobs move to PostgreSQL.

    outputs/jobs/<id>/job.json        the job record (kind, status, spec, timings)
    outputs/jobs/<id>/perimeter.json  the perimeter the trainer or evaluator reads (--perimeter)
    outputs/jobs/<id>/train.log       trainer (or evaluator) and SUMO output
    outputs/jobs/<id>/run/            the trainer's output folder (episodes.csv, agent.pt, ...)
                                      or the evaluator's (runs/*.json, summary.json, ...)
    outputs/jobs/<id>/agent.pt        comparisons: the agent as it was when the comparison was created

Jobs run in their own process group, so they survive an API reload; a restarted API adopts running jobs by
PID and settles their status from the trainer's output when they end.
"""
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import shutil
import uuid
from typing import Literal

import numpy as np

from pydantic import BaseModel, Field, field_validator

from atc_api import settings
from atc_api.perimeter import LightOverride, PerimeterSpec
from shared_green_rl.evaluate import fixed_label, summarize

Status = Literal['queued', 'running', 'completed', 'failed', 'cancelled']
Kind = Literal['training', 'comparison']


def kind_of(job: dict) -> Kind:
    return job.get('kind', 'training')  # jobs from before comparisons existed are training jobs


class DemandProfile(BaseModel):
    id: str
    name: str
    description: str
    trips_08_09: int
    option: Literal['--route-files', '--extra-routes'] | None = None
    path: str | None = None


DEMAND_PROFILES = [
    DemandProfile(id='baseline', name='Baseline (LuST)', trips_08_09=25382,
                  description='The original LuST demand, 06:00-11:00 files.'),
    DemandProfile(id='two_stage_strict', name='Two-stage strict', trips_08_09=30382,
                  option='--route-files', path='scenario/two_stage_strict_timestate/all_demand.rou.xml',
                  description='Baseline plus 3,000 B→A and 2,000 A→B trips, B→A crossings in the second half.'),
    DemandProfile(id='ba_plus3000_secondhalf', name='BA+3000 second half', trips_08_09=28382,
                  option='--extra-routes', path='scenario/ba_plus3000_secondhalf/extra_ba.rou.xml',
                  description='Baseline plus 3,000 B→A trips peaking at 08:40.'),
    DemandProfile(id='aa_plus3000', name='AA+3000', trips_08_09=28382,
                  option='--extra-routes', path='scenario/aa_plus3000/extra_aa.rou.xml',
                  description='Baseline plus 3,000 trips inside A, centred at 08:30.'),
]
PROFILES = {p.id: p for p in DEMAND_PROFILES}


class TrainingSettings(BaseModel):
    """Reference-mode training. Defaults are the documented experiment settings."""
    episodes: int = Field(50, ge=1, le=1000)
    generators: int = Field(8, ge=1, le=64)
    min_green: float = Field(5, ge=1, le=30)
    noise: float = Field(2, ge=0, le=20)
    seed: int = 42
    sumo_seed: int = 42
    exploration_seed: int = 10000
    begin: int = Field(28800, ge=0, le=86400)
    duration: int = Field(3600, ge=90, le=4 * 3600)
    train_sample_size: int = Field(1000, ge=2)
    critic_epochs: int = Field(128, ge=1)
    critic_batch_size: int = Field(256, ge=1)
    critic_validation_fraction: float = Field(0.2, gt=0, lt=1)
    critic_patience: int = Field(20, ge=1)
    actor_steps: int = Field(2, ge=1)
    target_update_period: int = Field(5, ge=1)

    @field_validator('duration')
    @classmethod
    def whole_cycles(cls, v: int) -> int:
        if v % settings.CYCLE_SECONDS:
            raise ValueError(f'Use a multiple of {settings.CYCLE_SECONDS} seconds (whole control cycles).')
        return v


class JobCreate(BaseModel):
    """What the UI (and later the orchestrator) sends. The server builds and checks the perimeter itself."""
    name: str = Field(min_length=1, max_length=80)
    region_a_edges: list[str] = Field(min_length=1)
    overrides: dict[str, LightOverride] = Field(default_factory=dict)
    demand_profile: str = 'baseline'
    training: TrainingSettings = Field(default_factory=TrainingSettings)

    @field_validator('demand_profile')
    @classmethod
    def known_profile(cls, v: str) -> str:
        if v not in PROFILES:
            raise ValueError(f'Unknown demand profile. Use one of: {", ".join(PROFILES)}.')
        return v


class ComparisonCreate(BaseModel):
    """Compare a training job's agent with fixed-time control. Unset fields follow the training job."""
    name: str | None = Field(None, max_length=80)
    demand_profile: str | None = None
    #: constant B→A budgets in seconds; None = the low, midpoint and high of the job's action range (D4.5)
    fixed_budgets: list[float] | None = Field(None, max_length=10)
    include_agent: bool = True
    sumo_seeds: list[int] = Field(default_factory=lambda: [42], min_length=1, max_length=10)
    workers: int = Field(4, ge=1, le=64)

    @field_validator('demand_profile')
    @classmethod
    def known_profile(cls, v: str | None) -> str | None:
        if v is not None and v not in PROFILES:
            raise ValueError(f'Unknown demand profile. Use one of: {", ".join(PROFILES)}.')
        return v

    @field_validator('fixed_budgets')
    @classmethod
    def distinct(cls, v: list[float] | None) -> list[float] | None:
        return None if v is None else sorted(set(round(x, 2) for x in v))

    @field_validator('sumo_seeds')
    @classmethod
    def distinct_seeds(cls, v: list[int]) -> list[int]:
        return sorted(set(v))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)  # readers never see half a file


def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class JobStore:
    def __init__(self, root: Path = settings.JOBS_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.processes: dict[str, subprocess.Popen] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # records ---------------------------------------------------------------------------------------------------

    def folder(self, job_id: str) -> Path:
        return self.root / job_id

    def get(self, job_id: str) -> dict | None:
        path = self.folder(job_id) / 'job.json'
        if not job_id.replace('-', '').isalnum() or not path.is_file():
            return None
        return json.loads(path.read_text(encoding='utf-8'))

    def save(self, job: dict) -> dict:
        with self.lock:
            job['updated_at'] = now()
            _write_json(self.folder(job['_id']) / 'job.json', job)
        return job

    def all(self, kind: Kind | None = None) -> list[dict]:
        if not self.root.is_dir():  # deleted while the API runs (tests clean up)
            return []
        jobs = [self.get(p.name) for p in self.root.iterdir() if (p / 'job.json').is_file()]
        return sorted((j for j in jobs if j and (kind is None or kind_of(j) == kind)),
                      key=lambda j: j['created_at'], reverse=True)

    def _new(self) -> tuple[str, Path]:
        job_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]
        folder = self.folder(job_id)
        folder.mkdir(parents=True)
        return job_id, folder

    def create(self, spec: JobCreate, perimeter: PerimeterSpec, summary: dict) -> dict:
        job_id, folder = self._new()
        _write_json(folder / 'perimeter.json', perimeter.model_dump())
        job = dict(_id=job_id, kind='training', name=spec.name, status='queued', created_at=now(), started_at=None,
                   finished_at=None, spec=spec.model_dump(), perimeter=summary, pid=None, return_code=None,
                   error=None, cancel_requested=False)
        return self.save(job)

    def agent_checkpoint(self, training_id: str) -> Path | None:
        path = self.folder(training_id) / 'run' / 'agent.pt'
        return path if path.is_file() else None

    def create_comparison(self, training: dict, spec: ComparisonCreate) -> dict:
        """A comparison for a training job. Raises ValueError with a message for the user."""
        t = training['spec']['training']
        low, high = training['perimeter']['action_bounds']
        budgets = spec.fixed_budgets if spec.fixed_budgets is not None else [low, (low + high) / 2, high]
        outside = [b for b in budgets if not low <= b <= high]
        if outside:
            raise ValueError(f'Fixed budgets must be within the action range {low:g}–{high:g} s '
                             f'({", ".join(f"{b:g}" for b in outside)} s is not).')
        checkpoint = self.agent_checkpoint(training['_id']) if spec.include_agent else None
        if spec.include_agent and checkpoint is None:
            raise ValueError('This training job has no trained agent yet (agent.pt is written after the first round).')
        if not budgets and not spec.include_agent:
            raise ValueError('Nothing to compare: add a fixed-time budget or include the trained agent.')
        rounds = len(self.rounds(training['_id']))
        profile = spec.demand_profile or training['spec']['demand_profile']
        job_id, folder = self._new()
        shutil.copy2(self.folder(training['_id']) / 'perimeter.json', folder / 'perimeter.json')
        if checkpoint:
            shutil.copy2(checkpoint, folder / 'agent.pt')  # a snapshot: training may still be running
        controllers = [fixed_label(b) for b in budgets] + (['agent'] if checkpoint else [])
        resolved = spec.model_dump() | dict(
            demand_profile=profile, fixed_budgets=budgets, training_job_id=training['_id'],
            training_job_name=training['name'], agent_rounds=rounds if checkpoint else None,
            begin=t['begin'], duration=t['duration'], min_green=t['min_green'], controllers=controllers)
        name = spec.name or f'{training["name"]} · {PROFILES[profile].name}'
        job = dict(_id=job_id, kind='comparison', name=name, status='queued', created_at=now(), started_at=None,
                   finished_at=None, spec=resolved, perimeter=training['perimeter'], pid=None, return_code=None,
                   error=None, cancel_requested=False)
        return self.save(job)

    # progress --------------------------------------------------------------------------------------------------

    def rounds(self, job_id: str) -> list[dict]:
        path = self.folder(job_id) / 'run' / 'episodes.csv'
        if not path.is_file():
            return []
        keep = ('episode', 'mean_reward', 'mean_tts', 'mean_completed', 'mean_completion_rate', 'critic_loss',
                'actor_loss', 'elapsed_seconds')
        with path.open(newline='') as f:
            return [{k: float(row[k]) if row.get(k) not in (None, '') else None for k in keep}
                    for row in csv.DictReader(f)]

    def comparison_runs(self, job_id: str) -> list[dict]:
        """Finished simulations of a comparison (one per controller and seed), with their cycles."""
        folder = self.folder(job_id) / 'run' / 'runs'
        runs = []
        for path in sorted(folder.glob('*.json')) if folder.is_dir() else []:
            try:
                runs.append(json.loads(path.read_text(encoding='utf-8')))
            except (OSError, json.JSONDecodeError):
                pass  # still being written
        return runs

    def comparison_results(self, job: dict) -> dict:
        """The comparison table (mean over seeds, change against the best fixed budget) and mean cycles."""
        controllers = job['spec']['controllers']
        runs = self.comparison_runs(job['_id'])
        done = [c for c in controllers if any(r['controller'] == c for r in runs)]
        summary = summarize(runs, done) if runs else []
        cycles = {}
        for c in done:
            mine = [r['cycles'] for r in runs if r['controller'] == c]
            n = min(len(x) for x in mine)
            cycles[c] = [dict(time=mine[0][i]['time'],
                              **{k: float(np.mean([x[i][k] for x in mine]))
                                 for k in ('ba_seconds', 'completed', 'tts', 'accumulation_a', 'accumulation_b')})
                         for i in range(n)]
        return dict(summary=summary, cycles=cycles,
                    runs=[{k: r[k] for k in ('controller', 'sumo_seed', 'completed', 'tts', 'elapsed_seconds')}
                          for r in runs])

    def _comparison_progress(self, job: dict) -> dict:
        spec = job['spec']
        total = len(spec['controllers']) * len(spec['sumo_seeds'])
        runs = self.comparison_runs(job['_id'])
        times = [r['elapsed_seconds'] for r in runs]
        eta = None
        if times and job['status'] == 'running':
            batches = -(-(total - len(runs)) // max(1, min(spec['workers'], total)))
            eta = sum(times) / len(times) * batches
        return dict(runs_done=len(runs), runs_total=total, fraction=len(runs) / total if total else 0,
                    eta_seconds=eta)

    def progress(self, job: dict) -> dict:
        if kind_of(job) == 'comparison':
            return self._comparison_progress(job)
        rounds = self.rounds(job['_id'])
        total = job['spec']['training']['episodes']
        generators = job['spec']['training']['generators']
        current = None
        if job['status'] == 'running':
            episodes = sorted((self.folder(job['_id']) / 'run').glob('episode_*'))
            if episodes and len(episodes) > len(rounds):  # a round still collecting or training
                done = len(list(episodes[-1].glob('generator_*/episode.json')))
                current = dict(episode=len(episodes) - 1, simulations_done=done, simulations=generators)
        per_round = [r['elapsed_seconds'] for r in rounds if r['elapsed_seconds']]
        eta = (sum(per_round) / len(per_round)) * (total - len(rounds)) if per_round and job['status'] == 'running' \
            else None
        return dict(rounds_done=len(rounds), rounds_total=total, current=current,
                    fraction=len(rounds) / total if total else 0, eta_seconds=eta)

    def log_tail(self, job_id: str, lines: int = 200) -> list[str]:
        path = self.folder(job_id) / 'train.log'
        if not path.is_file():
            return []
        with path.open('rb') as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 256 * 1024))
            return f.read().decode('utf-8', 'replace').splitlines()[-lines:]

    # running ---------------------------------------------------------------------------------------------------

    def _comparison_command(self, job: dict) -> list[str]:
        spec, folder = job['spec'], self.folder(job['_id'])
        cmd = [settings.PYTHON, '-B', '-m', 'shared_green_rl.evaluate',
               '--fixed', *[f'{b:g}' for b in spec['fixed_budgets']],
               '--sumo-seeds', *[str(s) for s in spec['sumo_seeds']], '--workers', str(spec['workers']),
               '--begin', str(spec['begin']), '--duration', str(spec['duration']), '--min-green', str(spec['min_green']),
               '--state-scale', '1000', '--derivative-scale', '100']
        if spec['include_agent']:
            cmd += ['--agent', str(folder / 'agent.pt')]
        profile = PROFILES[spec['demand_profile']]
        if profile.option:
            cmd += [profile.option, str(settings.ROOT / profile.path)]
        cmd += ['--perimeter', str(folder / 'perimeter.json'), '--output', str(folder / 'run')]
        return cmd

    def command(self, job: dict) -> list[str]:
        if kind_of(job) == 'comparison':
            return self._comparison_command(job)
        t = job['spec']['training']
        folder = self.folder(job['_id'])
        cmd = [settings.PYTHON, '-B', '-m', 'shared_green_rl.train_parallel', '--training-mode', 'reference']
        for key in ('episodes', 'generators', 'train_sample_size', 'critic_epochs', 'critic_batch_size',
                    'critic_validation_fraction', 'critic_patience', 'actor_steps', 'target_update_period',
                    'noise', 'seed', 'sumo_seed', 'exploration_seed', 'begin', 'duration', 'min_green'):
            cmd += [f'--{key.replace("_", "-")}', str(t[key])]
        cmd += ['--state-scale', '1000', '--derivative-scale', '100']
        profile = PROFILES[job['spec']['demand_profile']]
        if profile.option:
            cmd += [profile.option, str(settings.ROOT / profile.path)]
        cmd += ['--perimeter', str(folder / 'perimeter.json'), '--output', str(folder / 'run')]
        return cmd

    def _start(self, job: dict) -> None:
        folder = self.folder(job['_id'])
        cmd = self.command(job)
        log = (folder / 'train.log').open('ab')
        log.write(f'$ {" ".join(cmd)}\n'.encode())
        log.flush()
        try:
            process = subprocess.Popen(cmd, cwd=settings.ROOT, stdout=log, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL, start_new_session=True,
                                       env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        except OSError as e:
            job.update(status='failed', finished_at=now(), error=f'Could not start the process: {e}')
            self.save(job)
            return
        finally:
            log.close()
        self.processes[job['_id']] = process
        job.update(status='running', started_at=now(), pid=process.pid, command=cmd)
        self.save(job)

    def _finished(self, job: dict) -> bool:
        process = self.processes.get(job['_id'])
        if process is not None:
            code = process.poll()
            if code is None:
                return False
            job['return_code'] = code
            del self.processes[job['_id']]
            return True
        return not _alive(job.get('pid'))  # adopted from an earlier API process

    def _settle(self, job: dict) -> None:
        if kind_of(job) == 'comparison':
            p = self._comparison_progress(job)
            done, total, unit = p['runs_done'], p['runs_total'], 'simulations'
            finished = (self.folder(job['_id']) / 'run' / 'summary.json').is_file()
        else:
            done, total, unit = len(self.rounds(job['_id'])), job['spec']['training']['episodes'], 'rounds'
            finished = done >= total
        if job.get('cancel_requested'):
            job['status'] = 'cancelled'
        elif finished and job.get('return_code') in (0, None):
            job['status'] = 'completed'
        else:
            tail = [l for l in self.log_tail(job['_id'], 40) if l.strip()]
            errors = [l for l in tail if 'Error' in l or 'error:' in l]
            job['status'] = 'failed'
            job['error'] = (errors[-1] if errors else tail[-1] if tail else 'The process stopped.') + \
                f' (after {done} of {total} {unit}; see the log)'
        job['finished_at'] = now()
        self.save(job)

    def tick(self) -> None:
        with self.lock:
            jobs = self.all()
            for job in jobs:
                if job['status'] == 'running' and self._finished(job):
                    self._settle(job)
            running = sum(1 for j in self.all() if j['status'] == 'running')
            for job in sorted((j for j in jobs if j['status'] == 'queued'), key=lambda j: j['created_at']):
                if running >= settings.MAX_RUNNING_JOBS:
                    break
                self._start(job)
                running += 1

    def cancel(self, job_id: str) -> dict | None:
        with self.lock:
            job = self.get(job_id)
            if job is None or job['status'] not in ('queued', 'running'):
                return job
            job['cancel_requested'] = True
            if job['status'] == 'queued':
                job.update(status='cancelled', finished_at=now())
            elif job.get('pid'):
                try:  # the trainer, its workers and their SUMO processes share the group
                    os.killpg(job['pid'], signal.SIGTERM)
                except ProcessLookupError:
                    pass
            return self.save(job)

    def start(self) -> None:
        def loop():
            while not self._stop.wait(2):
                try:
                    self.tick()
                except Exception as e:  # keep the runner alive; the API reports per-job errors
                    print(f'[atc jobs] {e!r}', flush=True)
        self.tick()
        self._thread = threading.Thread(target=loop, name='atc-job-runner', daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def public(job: dict, store: JobStore) -> dict:
    """The job as the API returns it."""
    out = {k: v for k, v in job.items() if k not in ('pid', 'cancel_requested', 'command')}
    out['kind'] = kind_of(job)
    out['progress'] = store.progress(job)
    out['demand_profile'] = PROFILES[job['spec']['demand_profile']].name
    if out['kind'] == 'training':
        out['has_agent'] = store.agent_checkpoint(job['_id']) is not None
    return out
