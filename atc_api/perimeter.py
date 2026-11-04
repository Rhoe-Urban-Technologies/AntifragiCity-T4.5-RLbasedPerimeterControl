"""Perimeter analysis: from a Region A selection to the lights the agent can control and their phase roles.

A light can be part of the perimeter when it controls a movement that crosses the A/B boundary. Each green
phase (uppercase G, as in the trainer) is classified from the movements it gives priority green to:

- `ba`: only B-to-A crossings (plus any A-to-A / B-to-B movements);
- `ab`: only A-to-B crossings;
- `mixed`: both directions at once. The shared budget can't split it, so it keeps its fixed duration;
- `none`: no crossing at all. Kept at its fixed duration.

The user can override the role of any green phase (`ba`, `ab` or `fixed`) and leave lights out. The action bounds
follow `shared_green_rl.signals.SignalMapping`: every service phase gets at least `min_green` seconds and the
cycle stays 90 seconds, so the same numbers come out when the trainer loads the perimeter.
"""
import math
from typing import Literal

from pydantic import BaseModel, Field

from atc_api.network import Network
from atc_api.settings import CYCLE_SECONDS

Role = Literal['ba', 'ab', 'fixed']


class LightOverride(BaseModel):
    include: bool | None = None
    #: phase index (as a string, JSON keys) -> role; only for green phases
    roles: dict[str, Role] = Field(default_factory=dict)


class PhaseReport(BaseModel):
    index: int
    state: str
    duration: float
    green: bool
    detected: Literal['ba', 'ab', 'mixed', 'none'] | None   # None for clearance / non-service phases
    role: Literal['ba', 'ab', 'fixed']
    overridden: bool = False


class LightReport(BaseModel):
    id: str
    location: tuple[float, float]
    crossings_in: int       # B-to-A movements this light controls
    crossings_out: int      # A-to-B movements this light controls
    included: bool
    status: Literal['ok', 'warning', 'error', 'excluded']
    messages: list[str]
    phases: list[PhaseReport]
    green_budget: float     # cycle minus phases that keep their duration
    bounds: tuple[float, float] | None    # this light's feasible B-to-A budget


class PerimeterSignal(BaseModel):
    id: str
    ba_phases: list[int]
    ab_phases: list[int]


class PerimeterSpec(BaseModel):
    """The file the trainer reads with --perimeter."""
    version: int = 1
    network: str
    region_a_edges: list[str]
    signals: list[PerimeterSignal]


class Analysis(BaseModel):
    region_a_edges: list[str]
    region_edge_count: int
    region_length_km: float
    lights: list[LightReport]
    crossings: dict[str, int]   # controlled / other_lights / unsignalised (distinct boundary movements)
    action_bounds: tuple[float, float] | None
    min_green: int
    valid: bool
    errors: list[str]
    perimeter: PerimeterSpec | None


def _side(edge: str, region_a: set[str]) -> str:
    return 'A' if edge in region_a else 'B'


def analyze(network: Network, region_a: set[str], overrides: dict[str, LightOverride] | None = None,
            min_green: float = 5) -> Analysis:
    overrides = overrides or {}
    mg = math.ceil(min_green)
    errors: list[str] = []
    unknown = region_a - network.edges.keys()
    if unknown:
        errors.append(f'{len(unknown)} Region A edges are not in the network (e.g. {sorted(unknown)[0]}).')
        region_a = region_a & network.edges.keys()
    if not region_a:
        errors.append('Region A is empty: draw a region that contains at least one road.')
    elif len(region_a) == len(network.edges):
        errors.append('Region A contains the whole network, so there is no boundary to control.')

    def crossing(pair):
        a, b = _side(pair[0], region_a), _side(pair[1], region_a)
        return 'ba' if (a, b) == ('B', 'A') else 'ab' if (a, b) == ('A', 'B') else None

    lights: list[LightReport] = []
    for light in network.lights.values():
        link_kind = {i: {crossing(p) for p in pairs} - {None} for i, pairs in light.links.items()}
        n_in = sum(1 for pairs in light.links.values() for p in pairs if crossing(p) == 'ba')
        n_out = sum(1 for pairs in light.links.values() for p in pairs if crossing(p) == 'ab')
        if not (n_in or n_out):
            continue  # not on this perimeter
        override = overrides.get(light.id, LightOverride())
        messages: list[str] = []
        phases: list[PhaseReport] = []
        for ph in light.phases:
            if not ph.is_green:
                phases.append(PhaseReport(index=ph.index, state=ph.state, duration=ph.duration, green=False,
                                          detected=None, role='fixed'))
                continue
            kinds = set().union(*(link_kind.get(i, set()) for i, ch in enumerate(ph.state) if ch == 'G'))
            detected = 'mixed' if kinds == {'ba', 'ab'} else kinds.pop() if kinds else 'none'
            default = detected if detected in ('ba', 'ab') else 'fixed'
            role = override.roles.get(str(ph.index), default)
            phases.append(PhaseReport(index=ph.index, state=ph.state, duration=ph.duration, green=True,
                                      detected=detected, role=role, overridden=role != default))
            if detected == 'mixed' and role == 'fixed':
                messages.append(f'Phase {ph.index} serves B→A and A→B at once, so it keeps its {ph.duration:g} s. '
                                'Separate those movements in the network to control it.')
            elif detected == 'none' and role == 'fixed':
                messages.append(f'Phase {ph.index} serves no boundary crossing and keeps its {ph.duration:g} s.')
            elif role != default:
                serves = {'ba': 'B→A', 'ab': 'A→B', 'mixed': 'both directions', 'none': 'no crossing'}[detected]
                given = {'ba': 'the B→A budget', 'ab': 'the A→B share', 'fixed': 'its fixed duration'}[role]
                messages.append(f'Phase {ph.index} serves {serves} but was set by hand to {given}.')
        ba = [p.index for p in phases if p.role == 'ba']
        ab = [p.index for p in phases if p.role == 'ab']
        budget = CYCLE_SECONDS - sum(p.duration for p in phases if p.role == 'fixed')
        problems = []
        if not ba:
            problems.append('No B→A phase to give the shared budget to.')
        if not ab:
            problems.append('No A→B phase to give the remaining green to.')
        bounds = None
        if ba and ab:
            low, high = len(ba) * mg, budget - len(ab) * mg
            if low > high:
                problems.append(f'{len(ba) + len(ab)} service phases at {mg} s minimum don\'t fit in the '
                                f'{budget:g} s of green this light has.')
            else:
                bounds = (float(low), float(high))
        # A light with problems can't be controlled; otherwise it's in unless the user left it out.
        if problems:
            included, status = False, 'error'
        elif override.include is False:
            included, status = False, 'excluded'
        else:
            included, status = True, 'warning' if messages else 'ok'
        lights.append(LightReport(id=light.id, location=light.lonlat, crossings_in=n_in, crossings_out=n_out,
                                  included=included, status=status, messages=problems + messages, phases=phases,
                                  green_budget=budget, bounds=bounds))

    lights.sort(key=lambda l: (not l.included, l.id))
    included = {l.id for l in lights if l.included}
    counts = {'controlled': 0, 'other_lights': 0, 'unsignalised': 0}
    for pair, tl in network.movements.items():
        if crossing(pair):
            counts['controlled' if tl in included else 'other_lights' if tl else 'unsignalised'] += 1

    bounds = None
    chosen = [l for l in lights if l.included]
    if region_a and not chosen:
        errors.append('No traffic light on this boundary can be controlled. Include at least one.')
    if chosen:
        low = max(l.bounds[0] for l in chosen)
        high = min(l.bounds[1] for l in chosen)
        if low > high:
            tight = min(chosen, key=lambda l: l.bounds[1])
            errors.append(f'The lights have no common B→A budget: one needs at least {low:g} s, but light {tight.id} '
                          f'allows at most {high:g} s. Leave a light out or lower the minimum green.')
        else:
            bounds = (low, high)

    valid = not errors and bounds is not None
    edges = [network.edges[e] for e in region_a]
    return Analysis(
        region_a_edges=sorted(region_a), region_edge_count=len(region_a),
        region_length_km=round(sum(e.length for e in edges) / 1000, 1),
        lights=lights, crossings=counts, action_bounds=bounds, min_green=mg, valid=valid, errors=errors,
        perimeter=PerimeterSpec(network=network.id, region_a_edges=sorted(region_a), signals=[
            PerimeterSignal(id=l.id, ba_phases=[p.index for p in l.phases if p.role == 'ba'],
                            ab_phases=[p.index for p in l.phases if p.role == 'ab'])
            for l in chosen]) if valid else None)
