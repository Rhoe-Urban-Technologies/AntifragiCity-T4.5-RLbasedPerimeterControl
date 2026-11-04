"""Compare perimeter controllers on the same simulations: fixed-time budgets and a trained agent.

Fixed-time control follows D4.5 (section 5.1): the same phase-separated lights and signal mapping as the agent,
with a constant B-to-A green budget every 90-second cycle (by default the lower bound, midpoint and upper bound of
the action range: 10, 32.5 and 55 s for the reference perimeter). The trained agent runs its deterministic policy:
no exploration noise and no learning. Every controller sees the same demand, SUMO seeds and time window.

    python -B -m shared_green_rl.evaluate --agent outputs/reference_training/agent.pt \\
        --extra-routes scenario/aa_plus3000/extra_aa.rou.xml --output outputs/compare_aa3000

Outputs:

    <output>/settings.json                the command's settings and controllers
    <output>/sumo/<controller>_seed<s>/   SUMO's files for each run
    <output>/runs/<controller>_seed<s>.json  totals and one row per control cycle
    <output>/results.csv                  one row per run (written at the end)
    <output>/summary.json                 mean per controller over the seeds (written at the end)
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import csv
import json
import multiprocessing as mp
from pathlib import Path
from time import perf_counter

import numpy as np

from shared_green_rl.signals import SignalMapping, load_perimeter
from shared_green_rl.sumo_runtime import write_json


def fixed_label(seconds: float) -> str:
    return f'fixed-{seconds:g}'


def run_one(label, seconds, checkpoint, env_options, sumo_seed, folder, result_path):
    """One simulation with one controller. `seconds` for fixed time, `checkpoint` for the agent."""
    import torch
    from shared_green_rl.environment import Environment
    start = perf_counter()
    agent = None
    if checkpoint:
        from ddpg_agent import DDPG
        torch.set_num_threads(1)
        agent = DDPG.load(checkpoint)
    env = Environment(**env_options)
    cycles, tts, completed = [], 0, 0
    try:
        state = env.reset(folder, sumo_seed)
        done = False
        while not done:
            action = agent.choose_action(state, noise_std=0) if agent else np.array([seconds], dtype=np.float32)
            clock = env.traci.simulation.getTime()
            state, _, done, info = env.step(action)
            tts += info['tts']
            completed += info['completed']
            cycles.append(dict(time=clock, ba_seconds=info['ba_seconds'], completed=info['completed'],
                               tts=info['tts'], accumulation_a=float(env.n[0]), accumulation_b=float(env.n[1])))
    finally:
        env.close()
    result = dict(controller=label, sumo_seed=sumo_seed, completed=completed, tts=tts, cycles=cycles,
                  elapsed_seconds=perf_counter() - start)
    write_json(result_path, result)
    return result


def summarize(results, labels):
    """Mean completed trips and TTS per controller, and the change against the best fixed-time budget."""
    rows = []
    for label in labels:
        runs = [r for r in results if r['controller'] == label]
        rows.append(dict(controller=label, runs=len(runs),
                         completed=float(np.mean([r['completed'] for r in runs])),
                         tts=float(np.mean([r['tts'] for r in runs]))))
    fixed = [r for r in rows if r['controller'].startswith('fixed-')]
    best = min(fixed, key=lambda r: r['tts']) if fixed else None
    for r in rows:
        r['best_fixed'] = best['controller'] if best else None
        r['completed_change'] = (r['completed'] / best['completed'] - 1) if best else None
        r['tts_change'] = (r['tts'] / best['tts'] - 1) if best else None
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--fixed', type=float, nargs='*', default=None,
                        help='Fixed B-to-A budgets in seconds (default: low, midpoint and high of the action range)')
    parser.add_argument('--agent', type=Path, help='A trained agent.pt; omit to compare fixed-time budgets only')
    parser.add_argument('--sumo-seeds', type=int, nargs='+', default=[42])
    parser.add_argument('--workers', type=int, default=4, help='Simulations at once (about one CPU core each)')
    parser.add_argument('--begin', type=int, default=28800)
    parser.add_argument('--duration', type=int, default=3600)
    parser.add_argument('--min-green', type=float, default=5)
    parser.add_argument('--state-scale', type=float, default=1000, help='As in training (the agent sees this state)')
    parser.add_argument('--derivative-scale', type=float, default=100, help='As in training')
    parser.add_argument('--extra-routes', help='Supplemental route file')
    parser.add_argument('--route-files', help='Replacement route files')
    parser.add_argument('--perimeter', help='Perimeter JSON; default: the reference files')
    parser.add_argument('--sumo', default='sumo')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()

    perimeter = load_perimeter(args.perimeter) if args.perimeter else None
    mapping = SignalMapping(min_green=args.min_green, perimeter=perimeter)
    budgets = args.fixed if args.fixed is not None else [mapping.low, (mapping.low + mapping.high) / 2, mapping.high]
    for s in budgets:
        if not mapping.low <= s <= mapping.high:
            parser.error(f'Fixed budget {s:g} s is outside the action range {mapping.low:g}-{mapping.high:g} s')
    if not budgets and not args.agent:
        parser.error('Nothing to compare: give --fixed budgets or --agent')
    if args.agent and not args.agent.is_file():
        parser.error(f'No agent checkpoint at {args.agent}')
    if args.workers < 1:
        parser.error('--workers must be at least 1')

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    (output / 'runs').mkdir()
    controllers = [(fixed_label(s), float(s), None) for s in budgets]
    if args.agent:
        controllers.append(('agent', None, str(args.agent.resolve())))
    labels = [c[0] for c in controllers]
    env_options = dict(begin=args.begin, duration=args.duration, min_green=args.min_green, scale=args.state_scale,
                       derivative_scale=args.derivative_scale, sumo=args.sumo, extra_routes=args.extra_routes,
                       route_files=args.route_files,
                       perimeter=str(Path(args.perimeter).resolve()) if args.perimeter else None)
    write_json(output / 'settings.json', dict(
        controllers=labels, fixed_budgets=budgets, agent=controllers[-1][2] if args.agent else None,
        sumo_seeds=args.sumo_seeds, action_bounds=[mapping.low, mapping.high], env_options=env_options))

    jobs = [(label, seconds, checkpoint, env_options, seed, output / 'sumo' / f'{label}_seed{seed}',
             output / 'runs' / f'{label}_seed{seed}.json')
            for seed in args.sumo_seeds for label, seconds, checkpoint in controllers]
    print(f'{len(jobs)} simulations: {", ".join(labels)} x seeds {args.sumo_seeds}', flush=True)
    results = []
    with ProcessPoolExecutor(max_workers=min(args.workers, len(jobs)), mp_context=mp.get_context('spawn')) as pool:
        futures = [pool.submit(run_one, *job) for job in jobs]
        for future in as_completed(futures):
            r = future.result()
            results.append(r)
            print(f'[{len(results)}/{len(jobs)}] {r["controller"]} seed {r["sumo_seed"]}: '
                  f'{r["completed"]} completed trips, TTS {r["tts"]} veh·s ({r["elapsed_seconds"]:.0f} s)', flush=True)

    results.sort(key=lambda r: (labels.index(r['controller']), r['sumo_seed']))
    with (output / 'results.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, ['controller', 'sumo_seed', 'completed', 'tts', 'elapsed_seconds'])
        writer.writeheader()
        for r in results:
            writer.writerow({k: r[k] for k in writer.fieldnames})
    summary = summarize(results, labels)
    write_json(output / 'summary.json', summary)
    for r in summary:
        change = '' if r['completed_change'] is None else \
            f'  ({r["completed_change"]:+.2%} completed, {r["tts_change"]:+.2%} TTS vs {r["best_fixed"]})'
        print(f'{r["controller"]:>12}: {r["completed"]:.0f} completed trips, TTS {r["tts"]:.0f} veh·s{change}',
              flush=True)


if __name__ == '__main__':
    main()
