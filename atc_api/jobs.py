"""Training jobs: a spec saved on disk and the real trainer run as a local background process.

This is the stand-in for the SUMA orchestrator: the job spec (`JobCreate`) is the contract it will accept later,
and the folder layout maps onto tables (training_jobs, training_rounds) when jobs move to PostgreSQL.

    outputs/jobs/<id>/job.json        the job record (status, spec, timings)
    outputs/jobs/<id>/perimeter.json  the perimeter the trainer reads (--perimeter)
    outputs/jobs/<id>/train.log       trainer and SUMO output
    outputs/jobs/<id>/run/            the trainer's output folder (episodes.csv, agent.pt, ...)

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
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from atc_api import settings
from atc_api.perimeter import LightOverride, PerimeterSpec

Status = Literal['queued', 'running', 'completed', 'failed', 'cancelled']


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

    def all(self) -> list[dict]:
        jobs = [self.get(p.name) for p in self.root.iterdir() if (p / 'job.json').is_file()]
        return sorted((j for j in jobs if j), key=lambda j: j['created_at'], reverse=True)

    def create(self, spec: JobCreate, perimeter: PerimeterSpec, summary: dict) -> dict:
        job_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]
        folder = self.folder(job_id)
        folder.mkdir(parents=True)
        _write_json(folder / 'perimeter.json', perimeter.model_dump())
        job = dict(_id=job_id, name=spec.name, status='queued', created_at=now(), started_at=None,
                   finished_at=None, spec=spec.model_dump(), perimeter=summary, pid=None, return_code=None,
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

    def progress(self, job: dict) -> dict:
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

    def command(self, job: dict) -> list[str]:
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
            job.update(status='failed', finished_at=now(), error=f'Could not start the trainer: {e}')
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
        rounds = len(self.rounds(job['_id']))
        total = job['spec']['training']['episodes']
        if job.get('cancel_requested'):
            job['status'] = 'cancelled'
        elif rounds >= total and job.get('return_code') in (0, None):
            job['status'] = 'completed'
        else:
            tail = [l for l in self.log_tail(job['_id'], 40) if l.strip()]
            errors = [l for l in tail if 'Error' in l or 'error:' in l]
            job['status'] = 'failed'
            job['error'] = (errors[-1] if errors else tail[-1] if tail else 'The trainer stopped.') + \
                f' (after {rounds} of {total} rounds; see the log)'
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
    out['progress'] = store.progress(job)
    out['demand_profile'] = PROFILES[job['spec']['demand_profile']].name
    return out
