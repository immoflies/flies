# Immortal Fruit Fly

A 100-year-old fruit fly — the hero — outruns a swarm of fruit-fly predators in an
open-source, Subway-Surfers-style three-lane endless runner, steered by an AI agent.
It uses the same recipe as [cobanov/flyjump](https://github.com/cobanov/flyjump):
a **fixed, measured 80-cell MaleCNS fruit-fly connectome circuit** as a nonlinear
feature transform, with only a small trainable readout learned by cross-entropy
method (CEM).

The game engine is real and unmodified — it is **Jurassic Runner** from
`diegopacheco/ai-playground` (Unlicense), vendored verbatim under `vendor/`.
Its exact Subway Surfers mechanics are intact: three lanes, jump, duck, and
lane-switching. Only the *sprites and palette* are rethemed (see
[Theme overlay](#theme-overlay)) — dinosaurs became fruit-fly predators; the physics,
collisions, and rewards are untouched.

## How it works

```
8 engineered game observations
   -> fixed 80-cell MaleCNS circuit (signed, normalized contacts; leaky tanh)
   -> 16 descending-cell activities
   -> trained readout (16->12->5)  [269 params, learned via CEM]
   -> 5 actions: NOOP / LEFT / RIGHT / JUMP / DUCK
   -> injected into the game's KB input object each decision tick
```

Headless & deterministic:
- The game is loaded inside a **lexical platform adapter** (`lib/game-adapter.mjs`):
  a fake DOM / no-op-2D-context, a **seeded RNG**, and a **fixed performance clock**.
- Only `update(ts)` runs headlessly (rendering is skipped); the simulation is driven
  at a fixed 60 Hz with a decision every N ticks.
- The connectome is an **80-cell graph** (32 visual inputs + 32 bridge interneurons
  + 16 descending readout cells; 1,296 directed edges, 26,029 contacts) using the
  MaleCNS v1.0 fruit-fly circuit (FlyEM), following `cobanov/flyjump` (same 32 inputs,
  same 16 readout cells). It is mined with `scripts/build-connectome-250.py` (adapted
  from flyjump's builder; checked against the same source SHA-256 digests). Dynamics
  are the flyjump defaults (3 synchronous iterations, leak 0.7, gain 1.4, output gain 4).
- The 16 readout cells match the flyjump motif, so the readout architecture is the
  standard 16->12->5 (269 params). (A larger, 258-cell/10,713-edge variant was also
  mined and studied — see below — but the 80-cell circuit trains a stronger playing
  policy, so it is the shipped default.)

## Observations (8 channels)

| Ch | Feature | Purpose |
|----|---------|---------|
| 0 | proximity of the **in-lane** danger (0..1, 1=about to hit) | timed reactions (jump/duck) |
| 1 | that danger must be dodged by changing lane | move-obstacle |
| 2 | danger must be jumped | rock / raptor |
| 3 | danger must be ducked | pterodactyl |
| 4 | proximity of the nearest looming move-obstacle (any lane) | pre-position to dodge |
| 5 | steering offset of that move-threat | which direction gives space |
| 6 | player jump height | jump/airborne state |
| 7 | current lane (−1..+1 mapped to 0..1) | lane self-knowledge |

## Reproduce

```sh
npm test                # smoke + env tests (also verifies determinism)
# (re)mine the circuit from the full MaleCNS v1.0 source tables
#  (BRIDGES=32 -> 80-cell shipped default; BRIDGES=210 -> 258-cell experiment):
#  .venv/bin/python scripts/build-connectome-250.py /path/to/malecns-src 32
node scripts/train.mjs  # CEM training of the readout (worker-free, in Node)
node scripts/benchmark.mjs   # 100 held-out-seed evaluation vs control conditions
```

Training writes results to `public/checkpoints/`, benchmarking to
`public/benchmarks/`.

## Results

Trained readout (CEM, 60 generations × 64 candidates × 4 courses) on **100 held-out
seeds** (180 s cap), `decisionEvery=2` (30 Hz):

The following table records the **previous recenter-controller benchmark**, not the current checkpoint.

| Controller | mean survival | mean score | completed / 100 |
|---|---|---:|---:|
| **trained readout (80-cell connectome)** | **17.5 s** | **314** | 0 |
| trained readout, circuit silenced | 9.34 s | 127 | 0 |
| untrained random readout | 8.13 s | 101 | 0 |
| idle (NOOP) | 7.61 s | 90 | 0 |
| uniform random actions | 9.14 s | 122 | 0 |

- The trained agent survives **~2.3×** the idle and ~2× the random baselines, and it
  genuinely uses **all four actions** — it turns LEFT and RIGHT, jumps, and ducks
  (an automated test asserts LEFT/RIGHT/JUMP/DUCK on 30 held-out courses).
- Training fitness = survival **plus a small action-coverage bonus**, so the readout
  can't settle on a lopsided one-direction strategy: a purely survival-optimized
  champion hit 30.0 s but never turned left, and forcing balanced left/right/jump/duck
  behavior costs about half that (see `scripts/train.mjs` / `COVW`).
- Silencing the circuit collapses the trained policy back toward baseline — a clean
  control showing the learned behavior **depends on the circuit's activity**, exactly
  the flyjump result. Note the readout still *runs* when silenced; only the fixed
  circuit activity is zeroed.
- A larger **258-cell variant** (210 bridge interneurons, 10,713 edges) was mined and
  compared: it trains a functional but lower-ceiling policy (13.2 s) and needs ~6.7× more
  training wall-time. Response-time and 80-vs-258 analyses are archived in `docs/`
  (`80-vs-258-cell-report.pdf`, `circuit-comparison.png`, `response-time.png`).
- No run reached the 180 s cap: this task is materially harder than Dino (lane
  changes + timed jump/duck + obstacles queueing in the same lane at high speed).
  Earlier hand-written reactive controllers scored around 15–27 s; the current
  coverage-trained champion does not outperform that entire range.

Validation-fitness (survival + action-coverage bonus) climbed through training to a
stable plateau (see `public/checkpoints/training.json`). Because every corrective
action must actually be exercised — the readout is penalized for ignoring LEFT or
RIGHT — the champion trades raw survival (which pure-survival training pushed to
30 s by never turning one way) for four-action coverage: 17.532 s mean survival,
1.88–2.30× the tested baselines. This is not a guarantee of all actions in every run.

## Lane-retention update

The current controller holds its lateral position during NOOP/JUMP/DUCK, observes
danger in all three lanes, and was retrained with a small steering-reversal penalty.
LEFT/RIGHT still target the outer lanes; this is position retention, not a discrete
three-lane selection interface. The vendor source remains unchanged.

On the same 30 seeds (2100001–2100030), `node scripts/replay.mjs` reports
17.275 s mean survival for the saved legacy system and 22.577 s for the new system
(+30.7%). Both use LEFT/RIGHT/JUMP/DUCK. Reversals per course are nearly unchanged
(3.7 versus 3.6); these results do not establish that all visible jitter is gone.
The replay danger metric is a threshold-based count of steering decisions, not
a measurement of completed unsafe lane changes. Prior ablation/baseline results
above have not been rerun for this checkpoint.

`npm run build:live` builds the current UI, controller and fixed-60Hz scheduler.
`npm test` includes runtime and lane-retention regressions.

## Theme overlay

The vendored `game.js` is **never edited**. `public/theme.js` is concatenated into
`live.js` by `scripts/build-live.mjs`, so it shares the game's top-level scope and its
same-named `function` declarations replace the game's sprites:

| Replaced | Was | Is |
|---|---|---|
| `drawRunner` | running boy | a 100-year-old fruit fly — silvered abdomen, droopy compound eyes, grey beard tuft, bent antennae, a cane |
| `drawObstacle` | rock / raptor / ptero / tree / stego | a fruit-fly **predator** (robber-fly: banded abdomen, mandibles, red compound eyes) in three poses — `hover` = jump, `swoop` = duck, `stand` = dodge |
| `drawChaser` / `drawTrex` | T-Rex | a giant predator fly lunging from the bottom, and the death animation |
| `drawBackground` / `drawPath` / `drawProp` | jungle / dirt path / ferns | overripe orchard at dusk — cracked earth, gnarled old fruit trees, fallen rotting fruit, dry leaf litter |
| `crash` | "The T-Rex got you" | "A fruit-fly predator got you" |

The palette moved from jungle-green to an aged amber/bone accent (`.brand`, `.kbkey.on`,
buttons). Only sprites, backdrop, and copy changed — the trained circuit agent, the
game loop, and the benchmark results are all identical to the unthemed build.

## Live play

```sh
npm run build:live && npm run serve
# open http://127.0.0.1:8137  — the trained agent auto-plays the rendered game
```

`public/` is a self-contained page: vendored game.js + generated `live.js` with the
agent + `panels.js`. Keyboard (arrows/space/down) still works to take over.

The page is a four-panel flyjump-style workbench:

- **01 / GAME** — the rendered three-lane runner, auto-played by the agent.
- **02 / DECISION NETWORK** — live trained readout (16 circuit outputs → 12 hidden →
  5 actions); green/orange edges are signed contributions, chosen action highlighted.
- **03 / KEYBOARD OUTPUT** — which key the agent currently holds.
- **04 / BRAIN ACTIVITY** — the whole-brain MaleCNS atlas (~140k traced somata,
  optic/central/descending groups) rendered as the visible brain shape, with the
  80-cell circuit's live activity drawn bright on top within that same volume
  (drag to rotate, scroll to zoom).

## Honest scope

This demonstrates **numerical learning of a real control policy** and **dependence on
the connectome circuit's activity**. It does not claim biological-topology superiority;
the circuit's activity is a simulated, dimensionless rate model, and the game
observations are engineered, not vision.

## Licenses / attribution

- Game: The Unlicense (`vendor/jurassic-runner/`), prefixed by the original authors' docs.
- Connectome circuit data: from `cobanov/flyjump` (attribution-required source-available);
  underlying MaleCNS v1.0 data is CC BY 4.0 (FlyEM / HHMI Janelia + collaborators).
- All adapter/training/agent code here: your choice of MIT or the flyjump-style terms
  — **MIT** unless noted otherwise. See `ATTRIBUTION.md`.