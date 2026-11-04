"""Paths and limits. Everything can be overridden with ATC_* environment variables."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENARIO = ROOT / 'LuSTScenario-master' / 'scenario'
NETWORK = SCENARIO / 'lust_phase_separation.net.xml'
REGION_A = SCENARIO / 'Region_A.txt'

#: Where training jobs (spec, perimeter, log, trainer output) are kept. Must be outside the scenario folder.
JOBS_DIR = Path(os.environ.get('ATC_JOBS_DIR', ROOT / 'outputs' / 'jobs')).resolve()
#: The interpreter that runs the trainer: the one running this API unless told otherwise.
PYTHON = os.environ.get('ATC_PYTHON', sys.executable)
#: Training jobs that may run at once. Each uses about `generators` CPU cores for hours.
MAX_RUNNING_JOBS = int(os.environ.get('ATC_MAX_RUNNING_JOBS', '1'))
#: Browser origins allowed to call the API directly (the Vite dev server proxies /api, so this is for other set-ups).
CORS_ORIGINS = [o for o in os.environ.get('ATC_CORS_ORIGINS', 'http://localhost:5180').split(',') if o]

CYCLE_SECONDS = 90
