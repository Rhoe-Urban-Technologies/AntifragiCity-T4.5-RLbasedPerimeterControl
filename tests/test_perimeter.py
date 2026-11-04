"""The perimeter builder must reproduce the hand-made reference mapping the trainer was developed with."""
import pytest
from shapely.geometry import box

from atc_api.main import network, reference_region
from atc_api.perimeter import LightOverride, analyze
from shared_green_rl.signals import SignalMapping


@pytest.fixture(scope='module')
def reference():
    return analyze(network(), set(reference_region()))


def test_reference_finds_the_17_lights(reference):
    assert reference.valid
    assert {l.id for l in reference.lights if l.included} == {s.tls_id for s in SignalMapping().signals}
    assert all(l.status == 'ok' for l in reference.lights)
    assert reference.action_bounds == (10, 55)


def test_reference_phase_roles_match_the_manual_rule(reference):
    manual = {s.tls_id: (s.ba, s.ab) for s in SignalMapping().signals}
    for s in reference.perimeter.signals:
        assert (s.ba_phases, s.ab_phases) == manual[s.id], s.id


def test_trainer_mapping_from_perimeter_is_identical(reference):
    default = SignalMapping(5)
    built = SignalMapping(5, reference.perimeter.model_dump())
    assert (built.low, built.high) == (default.low, default.high)
    assert built.plan(32.5) == default.plan(32.5)


def test_leaving_a_light_out(reference):
    lid = reference.lights[0].id
    result = analyze(network(), set(reference_region()), {lid: LightOverride(include=False)})
    light = next(l for l in result.lights if l.id == lid)
    assert light.status == 'excluded' and not light.included
    assert lid not in {s.id for s in result.perimeter.signals}
    assert result.crossings['controlled'] < reference.crossings['controlled']


def test_a_light_without_an_ab_phase_is_an_error(reference):
    light = next(l for l in reference.lights if l.id == '-7124')  # one BA (0) and one AB (2) phase
    result = analyze(network(), set(reference_region()), {light.id: LightOverride(roles={'2': 'fixed'})})
    report = next(l for l in result.lights if l.id == light.id)
    assert report.status == 'error' and not report.included
    assert any('A→B' in m for m in report.messages)


def test_polygon_selects_edges_by_midpoint():
    net = network()
    w, s, e, n = net.bbox
    small = box(w + (e - w) * 0.45, s + (n - s) * 0.45, w + (e - w) * 0.55, s + (n - s) * 0.55)
    edges = net.edges_within(small)
    assert 0 < len(edges) < len(net.edges)
    assert all(small.contains(__import__('shapely').Point(net.edges[x].midpoint_lonlat)) for x in edges)


def test_empty_region_is_invalid():
    result = analyze(network(), set())
    assert not result.valid and result.errors
