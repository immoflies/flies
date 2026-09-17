// Held-out benchmark: trained readout vs control conditions, on 100 held-out seeds.
// Mirrors the flyjump control table (learned control + dependence on circuit activity).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Env } from "../lib/env.mjs";
import { initParams, PARAM_COUNT, ACTIONS } from "../lib/readout.mjs";
import { rollout } from "../lib/env.mjs";
import { makeRng } from "../lib/game-adapter.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const CHAMP = join(ROOT, "public/checkpoints/champion.json");

const N_TEST = 100;
const TEST_START = 2100001;
const CAP = 180;
const DE = Number(process.env.DE ?? 2);
const SEED = Number(process.env.SEED ?? 1);

// ------------------------- policy factories -------------------------
function seededParams(seed) {
  const rng = makeRng(seed);
  const p = new Float64Array(PARAM_COUNT);
  for (let i = 0; i < p.length; i++) p[i] = (rng() * 2 - 1); // nontrivial random readout
  return p;
}
function zeroParams() {
  return new Float64Array(PARAM_COUNT); // zero logits -> argmax 0 -> NOOP (idle)
}

// run a params-following policy over the N_TEST held-out seeds
function runPolicy(name, params, { ablated = false } = {}) {
  let completed = 0, sumElapsed = 0, sumScore = 0;
  for (let i = 0; i < N_TEST; i++) {
    const r = rollout(params, { seed: TEST_START + i, decisionEvery: DE, ablated, maxSeconds: CAP });
    sumElapsed += r.elapsed; sumScore += r.score;
    if (!r.crashed) completed++;
  }
  return { name, completed, meanElapsed: +(sumElapsed / N_TEST).toFixed(3), meanScore: +(sumScore / N_TEST).toFixed(1) };
}

// uniform random action per decision, seeded per episode
function runRandomActions() {
  let completed = 0, sumElapsed = 0, sumScore = 0;
  for (let i = 0; i < N_TEST; i++) {
    const seed = TEST_START + i;
    const env = new Env({ decisionEvery: DE, maxSeconds: CAP });
    env.reset({ seed });
    const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
    while (true) {
      const a = (rng() * ACTIONS.length) | 0;
      const res = env.step(ACTIONS[a]);
      if (res.done) { sumElapsed += res.elapsed; sumScore += res.score; if (!res.crashed) completed++; break; }
    }
  }
  return { name: "uniform random actions", completed, meanElapsed: +(sumElapsed / N_TEST).toFixed(3), meanScore: +(sumScore / N_TEST).toFixed(1) };
}

// ------------------------- main -------------------------
function fmt(r) {
  return `${r.name.padEnd(42)} completed=${String(r.completed).padStart(3)}/100  meanSurvival=${String(r.meanElapsed).padStart(7)}s  meanScore=${String(r.meanScore).padStart(7)}`;
}

async function main() {
  const champion = Float64Array.from(JSON.parse(readFileSync(CHAMP, "utf8")));
  const results = [];
  results.push(runPolicy("trained readout (connectome)", champion));
  results.push(runPolicy("trained readout, circuit silenced", champion, { ablated: true }));
  results.push(runPolicy("untrained random readout", seededParams(SEED)));
  results.push(runPolicy("idle (NOOP)", zeroParams()));
  results.push(runRandomActions());

  mkdirSync(join(ROOT, "public/benchmarks"), { recursive: true });
  for (const r of results) console.log(fmt(r));
  writeFileSync(
    join(ROOT, "public/benchmarks/benchmark.json"),
    JSON.stringify({ cfg: { nTest: N_TEST, testStart: TEST_START, cap: CAP, decisionEvery: DE, seed: SEED }, results }, null, 2)
  );
}
main().catch((e) => { console.error(e); process.exit(1); });