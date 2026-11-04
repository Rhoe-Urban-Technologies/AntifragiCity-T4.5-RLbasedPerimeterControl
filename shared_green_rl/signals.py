"""Read the edited network and allocate one shared green budget."""
from dataclasses import dataclass
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

SCENARIO = Path(__file__).resolve().parent.parent / "LuSTScenario-master/scenario"
NETWORK = SCENARIO / 'lust_phase_separation.net.xml'
SPECIAL = {'-4214', '-8782', '-29900', '-17072', '-12'}


@dataclass
class Signal:
    tls_id: str
    states: list[str]
    durations: list[float]
    ba: list[int]
    ab: list[int]


def load_perimeter(path):
    """Read a perimeter file: Region A edges and, per light, which phase indices are B-to-A and A-to-B.

    Green phases listed in neither keep their stored durations, like clearance phases.
    """
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    if not data.get('region_a_edges') or not data.get('signals'):
        raise ValueError(f'Perimeter needs region_a_edges and signals: {path}')
    return data


class SignalMapping:
    def __init__(self, min_green=5, perimeter=None):
        """Without a perimeter: the 17 reference lights and the first-green/SPECIAL rule."""
        self.min_green = math.ceil(min_green)
        net = ET.parse(NETWORK)
        self.signals = []
        programs = {}
        for t in net.findall('tlLogic'):
            programs.setdefault(t.get('id'), t)  # the first program per light, as before
        if perimeter is None:
            ids = json.loads((SCENARIO / 'boundary_intersections.json').read_text())['intersections']
            roles = {tls: None for tls in ids}
        else:
            roles = {s['id']: (list(s['ba_phases']), list(s['ab_phases'])) for s in perimeter['signals']}
        for tls, role in roles.items():
            if tls not in programs:
                raise ValueError(f'Traffic light {tls} is not in the network')
            phases = programs[tls].findall('phase')
            states = [p.get('state') for p in phases]
            durations = [float(p.get('duration')) for p in phases]
            if role is None:
                green_idx = [i for i, state in enumerate(states) if 'G' in state]
                split = 2 if tls in SPECIAL else 1
                ba, ab = green_idx[:split], green_idx[split:]
            else:
                ba, ab = role
                if not ba or not ab or set(ba) & set(ab) or not set(ba + ab) <= set(range(len(states))):
                    raise ValueError(f'Light {tls} needs distinct, existing B-to-A and A-to-B phases')
            self.signals.append(Signal(tls, states, durations, ba, ab))
        # Shared B-to-A budget bounds preserve every phase's minimum green.
        self.low = max(len(s.ba) * self.min_green for s in self.signals)
        self.high = min(self.green_budget(s) - len(s.ab) * self.min_green for s in self.signals)
        if self.min_green <= 0 or self.low > self.high:
            raise ValueError('Infeasible minimum green')

    @staticmethod
    def green_budget(signal):
        return 90 - sum(d for i, d in enumerate(signal.durations)
                        if i not in signal.ba + signal.ab)

    def plan(self, seconds):
        if not math.isfinite(seconds) or not self.low <= seconds <= self.high:
            raise ValueError(f'B-to-A budget must be within [{self.low}, {self.high}]')
        budget = round(seconds, 2)
        plans = {}
        for s in self.signals:
            durations = s.durations.copy()
            for indices, total in ((s.ba, budget), (s.ab, self.green_budget(s) - budget)):
                # Allocate integer hundredths so the phase sum stays exact.
                base, extra = divmod(round(total * 100), len(indices))
                for j, index in enumerate(indices):
                    durations[index] = (base + (j < extra)) / 100
            plans[s.tls_id] = durations
        return budget, plans
