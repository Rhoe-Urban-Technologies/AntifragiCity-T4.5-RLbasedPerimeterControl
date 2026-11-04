# Shared-green RL core

New to the codebase? Start with [the practical tutorial](TUTORIAL.md) for setup,
first-run commands, module explanations, output interpretation and all tunable
parameters.

Minimal standalone package for parallel DDPG training with elapsed time in the
state. Run commands from this directory. Python 3.12 and SUMO 1.24.0 were used
for the existing experiments.

## Contents

- `ddpg_agent.py`: actor, critic, replay, training updates and checkpoints.
- `shared_green_rl/train_parallel.py`: parallel collection and central training.
- `shared_green_rl/generating.py`: one frozen-policy SUMO rollout per generator.
- `shared_green_rl/environment.py`: states, completion reward and cycle stepping.
- `shared_green_rl/signals.py`: shared green allocation across the 17 lights.
- `shared_green_rl/sumo_runtime.py`: configuration copies and accumulation counts.
- `shared_green_rl/evaluate.py`: comparison of a trained agent with fixed-time
  control on the same simulations (D4.5, section 5.1). See
  [Comparison with fixed-time control](#comparison-with-fixed-time-control).
- `LuSTScenario-master/`: only the default configuration's required inputs,
  region definitions, boundary-light IDs and upstream license.
- `scenario/`: the three experimental demand profiles used in training;
  see [profile selection and commands](scenario/README.md).

- `atc_api/`: FastAPI back end for choosing the perimeter and running training
  jobs. It serves the network geometry, analyzes a Region A selection, and queues
  local training jobs and fixed-time comparisons. See [Perimeter selection UI](#perimeter-selection-ui).
- `ui/`: the React dashboard for it, built from the rhoe-ui `app-dashboard`
  template with the AntifragiCity theme from antifragicity-ui (checked out next
  to this repository). See [ui/README.md](ui/README.md).
- `tests/`: pytest for the perimeter builder, the API and the comparisons.

There are no plotting, summarizing or demand-generation scripts, saved outputs
or checkpoints in this package. The one evaluation tool is the fixed-time
comparison.
Training still writes its normal metrics and checkpoints when run.

The training loop, rollout worker, signal allocation and agent learning methods
are preserved from `shared_green_rl_server`. Packaging removes the agent's
self-test and replaces the baseline/audit dependency with runtime-only helpers.
Accumulation keeps the original rule: vehicles on internal junction lanes are
assigned using the incoming route edge; vehicles with no road are excluded.
No boundary audit reports are generated.

## Setup

Install SUMO separately and ensure `sumo` is on PATH. Set `SUMO_HOME` to the SUMO
installation directory so `$SUMO_HOME/tools/traci` is available.

```sh
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
sumo --version
```

## Train

The command below uses the original baseline demand, eight generators and the
reference training procedure. Keep `--training-mode reference` explicit: the
preserved CLI also supports legacy training and defaults to that mode.

```sh
python -B -m shared_green_rl.train_parallel --training-mode reference --episodes 50 --generators 8 --train-sample-size 1000 --critic-epochs 128 --critic-batch-size 256 --critic-validation-fraction 0.2 --critic-patience 20 --actor-steps 2 --target-update-period 5 --noise 2 --seed 42 --sumo-seed 42 --exploration-seed 10000 --begin 28800 --duration 3600 --min-green 5 --state-scale 1000 --derivative-scale 100 --output outputs/reference_training
```

To use a bundled demand profile, add one of these options to the training
command and choose a distinct output directory:

| Profile | Demand option |
|---|---|
| Two-stage strict (time-state experiment) | `--route-files scenario/two_stage_strict_timestate/all_demand.rou.xml` |
| BA+3000 second-half | `--extra-routes scenario/ba_plus3000_secondhalf/extra_ba.rou.xml` |
| AA+3000 | `--extra-routes scenario/aa_plus3000/extra_aa.rou.xml` |

Use only one profile at a time. The first replaces the original demand; the
other two append 3,000 trips to it. Relative paths are resolved from your working
directory. See [scenario/README.md](scenario/README.md) for complete commands.

Resume a completed run into a new output directory; `--episodes` is the number
of additional rounds. Other experiment settings are inherited.

```sh
python -B -m shared_green_rl.train_parallel --resume outputs/reference_training --episodes 50 --output outputs/reference_training_continued
```

## State, action and training

The seven inputs, in order, are:

```text
[n_A/1000, n_B/1000, dn_A/100, dn_B/100, d2n_A/100, d2n_B/100, elapsed_seconds/duration]
```

Accumulation is sampled once per 90-second control cycle. `dn` is the difference
from the previous cycle, and `d2n` is the difference between consecutive `dn`
values; neither is divided by seconds. Initial differences are zero and time
runs from zero to one. Six-input historical checkpoints are incompatible.

The scalar action is a shared B-to-A green budget, normally 10 to 55 seconds.
The cycle is 90 seconds. Clearance durations stay fixed; remaining green is
allocated to A-to-B phases. Multiple phases in each direction share its budget,
with durations allocated to two decimal places. SUMO uses one-second steps.

Reward is completed trips divided by 90 seconds. TTS remains a logged metric,
not a reward term. Every generator uses SUMO seed 42 by default; exploration
uses independent seeds. A full one-hour rollout provides 40 transitions per
generator, or 320 per eight-generator round.

Reference training samples up to 1,000 replay transitions, freezes their target
values, fits the critic with an 80/20 train/validation split and patience-based
stopping, takes two actor steps, and updates target networks every five rounds.

`episodes.csv` contains generator-averaged metrics. Each episode's
`rollout_agent.pt` is the frozen policy that produced those rollouts; the root
`agent.pt` is saved after learning. Resume also requires `replay_buffer.json`
and `settings.json`. Outputs should remain outside the scenario directory.

## Perimeter selection UI

The trainer takes `--perimeter perimeter.json` to train on a Region A and set of
boundary lights other than the reference ones. Without it, training uses
`Region_A.txt`, `boundary_intersections.json` and the first-green/`SPECIAL` rule,
exactly as before.

```json
{"version": 1, "network": "lust", "region_a_edges": ["-30944", "..."],
 "signals": [{"id": "-16078", "ba_phases": [0], "ab_phases": [2, 4]}]}
```

`atc_api` builds this file from a selection. A light is on the perimeter when it
controls a movement that crosses the A/B boundary. Each green phase (uppercase
`G`) is classified from the movements it gives green to: B→A, A→B, both
("mixed": keeps its fixed duration), or neither. For the reference Region A this
gives the same 17 lights and the same phase split as the manual rule
(`tests/test_perimeter.py`). Other regions often have mixed phases, because only
the 17 reference lights were separated by hand in `lust_phase_separation.net.xml`.
The UI marks such lights as partly controllable or not controllable.

```sh
python -m pip install -r requirements.txt -r requirements-api.txt
uvicorn atc_api.main:app --port 8000        # from this directory, with SUMO on PATH
cd ui && npx npm@11 install && npm run dev  # http://localhost:5180; needs ../antifragicity-ui (ui/README.md)
python -m pytest tests                      # perimeter and API tests
```

Jobs started from the UI run the trainer as a local background process, one at a
time by default (`ATC_MAX_RUNNING_JOBS`). Everything is kept under
`outputs/jobs/<id>/`: `job.json`, `perimeter.json`, `train.log` and the trainer's
`run/` folder. A restarted API picks up running jobs again by PID.

## Comparison with fixed-time control

`shared_green_rl.evaluate` reproduces the comparison in D4.5 (section 5.1,
Tables 2-4). Fixed-time control uses the same phase-separated lights and signal
mapping as the agent, with a constant B→A green budget every 90-second cycle.
By default the budgets are the lower bound, midpoint and upper bound of the
action range (10, 32.5 and 55 s for the reference perimeter). The trained agent
runs its deterministic policy: no exploration noise and no learning. Every
controller gets the same demand, SUMO seeds and time window, and the command
reports completed trips and total time spent (vehicle-seconds), plus their
change against the best fixed budget.

```sh
python -B -m shared_green_rl.evaluate --agent outputs/reference_training/agent.pt \
    --extra-routes scenario/aa_plus3000/extra_aa.rou.xml --sumo-seeds 42 \
    --workers 4 --output outputs/compare_aa3000
```

Options: `--fixed 10 32.5 55` for other budgets (an empty `--fixed` runs the
agent alone), no `--agent` for fixed time only, several `--sumo-seeds` for a
mean, and `--perimeter`, `--min-green`, `--begin`, `--duration` as in training.
One one-hour simulation takes about 4-5 minutes. The output folder has
`results.csv` (one row per run), `summary.json` (mean per controller) and
`runs/*.json` with one row per cycle (B→A green, completions, TTS, vehicles in A
and B).

The table in D4.5 doesn't say how the RL rows were measured (a noise-free run
of the final agent, or a training round's rollouts with exploration noise).
This command does the former. Compare results from the same machine and SUMO
version: a fixed 32.5 s run of Scenario 1 here (SUMO 1.26) gave 21,866
completed trips and 18,265,994 veh·s against D4.5's 21,928 and 18,286,670, and
the 10 s run differs by about 1%, which is more than the margins in the tables.

In the UI, a training job's page has **Compare with fixed time**. It copies the
job's current `agent.pt`, queues the comparison with the training jobs, and
shows the table, the change against the best fixed budget, the B→A green per
cycle and the vehicles in Region A. All comparisons are under **Fixed-time
comparisons**. The API is `POST /api/training-jobs/{id}/comparisons`,
`GET /api/comparisons[?training_job=]`, `GET /api/comparisons/{id}` (with
results), `/log` and `/cancel`.
