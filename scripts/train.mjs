// Cross-entropy method trainer: trains ONLY the readout (269 params) on top of
// the fixed 80-cell MaleCNS circuit. Fitness = mean survival seconds over a few
// courses. Mirrors the flyjump CEM design (code independently reimplemented).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rollout } from "../lib/env.mjs";
import { initParams, PARAM_COUNT } from "../lib/readout.mjs";
import { makeRng } from "../lib/game-adapter.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, "..", "public", "checkpoints");

// ---------------- CLI-ish defaults ----------------
const CFG = {
  generations: Number(process.env.GENS ?? 50),
  candidates: Number(process.env.CAND ?? 48),
  elites: Number(process.env.ELITES ?? 8),
  courses: Number(process.env.COURSES ?? 3),
  capSeconds: Number(process.env.CAP ?? 90),   // training cap (fitness saturates)
  trainSeed: Number(process.env.SEED ?? 20260916),
  decisionEvery: Number(process.env.DE ?? 2),
  sigmaFloor: 0.07,
  sigmaInit: 0.8,
  // Bonus (seconds) per distinct real action the policy uses (LEFT/RIGHT/JUMP/DUCK)
  // added to survival fitness, so CEM can't settle on a lopsided one-direction dodge.
  coverageWeight: Number(process.env.COVW ?? 1.3),
  // Penalty (seconds) per LEFT<->RIGHT oscillation during an episode — punishes
  // the 30 Hz flapping (choose left, then right, then left...) that made the
  // fly look like it was hopping into unsafe lanes.
  switchWeight: Number(process.env.SWITCHW ?? 0.01),
};
// validation seeds (fixed, not in training set) — mirrors flyjump split style
const VAL_SEEDS = [1100001, 1100002, 1100003, 1100004];
const TEST_START = 2100001;                   // held-out benchmark seeds start here

function drawGauss(rng) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// deterministic training course seeds for a generation, via seeded LCG
function courseSeeds(gen) {
  const rng = makeRng((CFG.trainSeed ^ (gen * 0x9e3779b9)) >>> 0);
  const out = [];
  for (let i = 0; i < CFG.courses; i++) out.push(1 + ((rng() * 900000) | 0));
  return out;
}

function evaluate(params, seeds, { ablated = false, cap = CFG.capSeconds } = {}) {
  let sum = 0, cov = 0, sw = 0;
  for (const s of seeds) {
    const r = rollout(params, { seed: s, decisionEvery: CFG.decisionEvery, ablated, maxSeconds: cap });
    sum += r.elapsed;
    cov += r.coverage ? r.coverage.reduce((a, b) => a + (b ? 1 : 0), 0) : 0;
    sw += r.switches || 0;
  }
  const n = seeds.length;
  return fitnessScore(sum / n, cov / n, sw / n, CFG);
}

// survival + coverage bonus - switch penalty. Exported so tests can assert the
// training incentive directly (coverage rewarding all four, switches penalised).
export function fitnessScore(meanElapsed, meanCov, meanSwitches, cfg) {
  return meanElapsed + cfg.coverageWeight * meanCov - cfg.switchWeight * meanSwitches;
}

export function train() {
  const { trainSeed } = CFG;
  const rng = makeRng(trainSeed);
  const mean = new Float64Array(PARAM_COUNT);
  let sigma = new Float64Array(PARAM_COUNT).fill(CFG.sigmaInit);
  // initial champion: random weights
  let champ = new Float64Array(PARAM_COUNT);
  for (let i = 0; i < PARAM_COUNT; i++) champ[i] = drawGauss(rng) * 0.7;
  let champVal = -Infinity;

  mkdirSync(OUT_DIR, { recursive: true });
  const log = [];
  for (let g = 0; g < CFG.generations; g++) {
    const seeds = courseSeeds(g);
    const cands = [champ];
    const candParams = [];
    candParams.push(champ);
    // sample candidates ~ N(mean, sigma)
    const sample = new Float64Array(PARAM_COUNT);
    for (let c = 1; c < CFG.candidates; c++) {
      for (let i = 0; i < PARAM_COUNT; i++) sample[i] = mean[i] + sigma[i] * drawGauss(rng);
      candParams.push(Float64Array.from(sample));
    }
    // evaluate
    const fits = candParams.map((p) => evaluate(p, seeds));

    // elites
    const idx = fits.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, CFG.elites);
    const el = idx.map(([, i]) => i);
    // new mean = mean of elites
    const newMean = new Float64Array(PARAM_COUNT);
    for (const i of el) for (let k = 0; k < PARAM_COUNT; k++) newMean[k] += candParams[i][k] / CFG.elites;
    // new sigma = stdev of elites (population), floored
    const newSigma = new Float64Array(PARAM_COUNT).fill(CFG.sigmaFloor);
    for (let k = 0; k < PARAM_COUNT; k++) {
      let v = 0;
      for (const i of el) { const d = candParams[i][k] - newMean[k]; v += d * d; }
      newSigma[k] = Math.max(CFG.sigmaFloor, Math.sqrt(v / CFG.elites));
      // apply momentum
      mean[k] = 0.3 * mean[k] + 0.7 * newMean[k];
      sigma[k] = 0.3 * sigma[k] + 0.7 * newSigma[k];
    }
    // best trained candidate this gen
    const bestFit = Math.max(...fits);
    const bestIdx = fits.indexOf(bestFit);

    // validation: evaluate champion on fixed VAL_SEEDS
    const val = evaluate(champ, VAL_SEEDS, { ablated: false });
    const genBest = Float64Array.from(candParams[bestIdx]);
    const genBestVal = evaluate(genBest, VAL_SEEDS, { ablated: false });
    if (genBestVal > champVal) {
      champ = genBest;
      champVal = genBestVal;
    }
    const row = {
      gen: g, bestTrain: +bestFit.toFixed(2), champTrain: +evaluate(champ, seeds).toFixed(2),
      champVal: +champVal.toFixed(2), champValRun: +val.toFixed(2), genVal: +genBestVal.toFixed(2),
    };
    log.push(row);
    if (g % 5 === 0 || g === CFG.generations - 1) {
      console.log(`gen=${String(g).padStart(3)} seed=${trainSeed}  bestTrain=${row.bestTrain}  champVal=${row.champVal}  champValRun=${row.champValRun}`);
    }
    writeFileSync(join(OUT_DIR, "training.json"), JSON.stringify({ CFG, valSeeds: VAL_SEEDS, log }, null, 2));
  }
  // save champion
  writeFileSync(join(OUT_DIR, "champion.json"), JSON.stringify(Array.from(champ)));
  writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify({ trainSeed: CFG.trainSeed, CFG, paramCount: PARAM_COUNT, valSeeds: VAL_SEEDS, testStart: TEST_START }, null, 2));
  return { champ, log, cfg: CFG };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const { champ, cfg } = train();
  console.log(`\nDONE. saved champion (${cfg.trainSeed}). wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
}