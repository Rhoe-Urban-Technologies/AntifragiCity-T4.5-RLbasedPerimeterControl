import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
# Jobs go to a throwaway folder and never start a trainer during tests.
os.environ.setdefault('ATC_JOBS_DIR', str(ROOT / 'outputs' / 'test_jobs'))
os.environ.setdefault('ATC_MAX_RUNNING_JOBS', '0')
