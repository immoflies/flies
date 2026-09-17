# IMMORTAL FRUIT FLIES · $FLIES

The fly plays; you watch. Two experimental games put a modeled fruit-fly
circuit in control, exposing the decisions behind every escape and failure.

**FLYINGFLIES** is an endless three-lane runner with a real fruit-fly
connectome lashed to the controls. A predator fly, banded abdomen and red
compound eyes, is always one mistake behind you. The hero is a
100-year-old fruit fly who has spent a lifetime that never ends learning
one thing: keep the lanes, keep moving. The trained readout survives
roughly 2.3 times longer than an idle fly and genuinely uses every action
it has — it turns, jumps and ducks instead of settling on one cowardly
direction. The benchmark that claims this is an archived control; the
living page is a fresh checkpoint, and the two are not the same number.

**SABER4FLIES** gives the circuit a different task: cut fruit through
arm movement — cyan on the left, rose on
the right, a swing becoming a judgement instead of a painted pixel. It is
more honest than it is finished: the arms can still drift when idle, and
right-center reach remains unreliable. An experiment dressed as a toy,
and it does not pretend otherwise.

Both games boot straight to an autonomous agent. There is no camera, no
account, no server that must watch. Just a browser, a wiring diagram, and
a fly deciding.

## The brain

The brain is not a metaphor. It is a graph measured from an actual fly:
32 visual inputs, 32 bridge interneurons, 16 descending command cells,
**1,296 directed connections carrying 26,029 contacts**, cut from the
MaleCNS v1.0 connectome (FlyEM / HHMI Janelia and colleagues, CC BY 4.0).

In the runner, engineered observations pass through a fixed,
signed, leaky-tanh transform to excite those 16 descending cells, and a
small trainable readout — **269 parameters, fitted by
cross-entropy method (CEM) search while the circuit stays fixed** — turns the result into one of five actions:
NOOP, LEFT, RIGHT, JUMP, DUCK. Saber uses separate motor readouts.

No pretense here. The observations are hand-engineered, not pixels. The
activity is a dimensionless simulated rate, not a recording. What the
circuit gives you is *structure* — a real wiring diagram doing real work
inside a toy, and the whole thing runs headless and deterministic, so the
same seed means the same fly every time.

## Run it

Requires Node.js 22.18+, npm and Python 3 for the static server.

```sh
npm test             # runner and site regression tests
npm run build:live   # emit /, /monitor/, /runner/, /saber/
npm run serve        # http://127.0.0.1:8137 — choose a game to watch
```

`npm run train` and `npm run benchmark` re-fit and re-measure the runner readout
in Node, writing checkpoints and results under `public/`.

## Honest scope

This is a demonstration that a real neural circuit graph can be learned
against, not a claim of biological superiority. Nothing here is financial,
tax or legal advice. Every $FLIES token field is provisional and subject
to change; verify anything on-chain yourself. SABER4FLIES has an
unresolved motor acceptance gate, and the runner's headline numbers
belong to an archived control, not the checkpoint on the live page.

## Credit

- Built with the [fly-connectome-template](https://github.com/cobanov/fly-connectome-template)
  by [Mert Cobanov](https://github.com/cobanov) — circuit and atlas data
  derive from [cobanov/flyjump](https://github.com/cobanov/flyjump).
- MaleCNS v1.0 soma + edge data: CC BY 4.0, FlyEM / HHMI Janelia,
  University of Cambridge, MRC Laboratory of Molecular Biology, and
  Google Research ([male-cns.janelia.org](https://male-cns.janelia.org)).
- Game engine: Jurassic Runner from
  [diegopacheco/ai-playground](https://github.com/diegopacheco/ai-playground),
  vendored under the Unlicense. Theme overlay is original to this project.
- See [LICENSE](LICENSE), [ATTRIBUTION.md](ATTRIBUTION.md), and
  [Saber attribution](games/saber/ATTRIBUTION.md) for the applicable terms.