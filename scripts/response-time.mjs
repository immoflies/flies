// Response-time benchmark: per-decision compute latency for a connectome graph,
// using code identical to lib/connectome.mjs + lib/readout.mjs so two circuit
// sizes compare apples-to-apples without swapping repo state.
//
//   node scripts/response-time.mjs <graph.json> [decisions] > out.json
//
// METHOD: individual `performance.now()` wrapping inflates tiny calls in
// virtualized environments, so the headline latency comes from BATCH timing
// (time N decisions, divide). Individual-step timing is reported separately as
// a distribution shape only, never as the absolute figure.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const DYNAMICS = { iterations: 3, leak: 0.7, gain: 1.4, outputGain: 4 };

// ---- readout: exact copy of lib/readout.mjs forward() ----
const N_IN = 16, N_HID = 12, N_OUT = 5;
const PARAM_COUNT = N_IN * N_HID + N_HID + N_OUT * N_HID + N_OUT; // 269
function forward(params, x) {
  let k = 0;
  const h = new Float64Array(N_HID);
  for (let i = 0; i < N_HID; i++) {
    let acc = 0;
    for (let j = 0; j < N_IN; j++) acc += params[k++] * x[j];
    acc += params[k++];
    h[i] = Math.tanh(acc);
  }
  const out = new Float64Array(N_OUT);
  for (let o = 0; o < N_OUT; o++) {
    let acc = 0;
    for (let j = 0; j < N_HID; j++) acc += params[k++] * h[j];
    acc += params[k++];
    out[o] = acc;
  }
  return out;
}
function argmax(a) {
  let bi = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
  return bi;
}

// ---- circuit: exact copy of lib/connectome.mjs step() ----
function buildCircuit(graph) {
  const count = graph.nodes.length;
  const totals = new Float64Array(count);
  for (const [pre, post, contacts] of graph.edges)
    totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
  const edges = graph.edges.map(([pre, post, contacts]) => [
    pre, post, totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0,
  ]);
  const activity = new Float64Array(count);
  const scratch = new Float64Array(count);
  const drive = new Float64Array(count);
  const inputs = graph.inputs;
  const outputs = graph.outputs;
  const { iterations, leak, gain, outputGain } = DYNAMICS;
  const out = new Float64Array(outputs.length);
  function step(obs) {
    drive.fill(0);
    for (let k = 0; k < inputs.length; k++) drive[inputs[k][0]] = 2 * (obs[inputs[k][1]] - 0.5);
    for (let t = 0; t < iterations; t++) {
      scratch.set(drive);
      for (let e = 0; e < edges.length; e++) {
        const pre = edges[e][0], post = edges[e][1], w = edges[e][2];
        scratch[post] += gain * w * activity[pre];
      }
      for (let i = 0; i < count; i++)
        activity[i] = (1 - leak) * activity[i] + leak * Math.tanh(scratch[i]);
    }
    for (let i = 0; i < outputs.length; i++) out[i] = activity[outputs[i]] * outputGain;
    return out;
  }
  return { step, nodes: count, edges: edges.length, outputs: outputs.length };
}

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
function median(a) { return pct(Array.from(a).sort((x, y) => x - y), 50); }

const graphPath = process.argv[2];
const STEPS = Number(process.argv[3] ?? 50000);
const WARM = 5000;
const BATCH = 500;
const BATCHES = Math.max(4, Math.floor(STEPS / BATCH));

const tLoad0 = performance.now();
const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const circuit = buildCircuit(graph);
const tLoad1 = performance.now();

const obs = new Float64Array(8);
let s = 12345;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 8; i++) obs[i] = rnd();

const params = new Float64Array(PARAM_COUNT);
for (let i = 0; i < params.length; i++) params[i] = rnd() * 0.4 - 0.2;

// burn-in (JIT warm)
for (let i = 0; i < WARM; i++) {
  obs[i % 8] = (obs[i % 8] + 0.013) % 1;
  argmax(forward(params, circuit.step(obs)));
}

// ---------- BATCH timing: circuit only ----------
const circBatchMs = [];
for (let b = 0; b < BATCHES; b++) {
  const t0 = performance.now();
  for (let i = 0; i < BATCH; i++) {
    obs[i % 8] = (obs[i % 8] + 0.013) % 1;
    circuit.step(obs);
  }
  circBatchMs.push((performance.now() - t0) / BATCH);
}

// ---------- BATCH timing: full decision ----------
const fullBatchMs = [];
for (let b = 0; b < BATCHES; b++) {
  const t0 = performance.now();
  for (let i = 0; i < BATCH; i++) {
    obs[i % 8] = (obs[i % 8] + 0.013) % 1;
    argmax(forward(params, circuit.step(obs)));
  }
  fullBatchMs.push((performance.now() - t0) / BATCH);
}

// ---------- distribution shape (relative only) ----------
const feat = circuit.step(obs);
const shapeNs = new Float64Array(2000);
for (let i = 0; i < shapeNs.length; i++) {
  const t0 = performance.now();
  argmax(forward(params, feat));
  shapeNs[i] = (performance.now() - t0) * 1e6;
}
const shapeSorted = Array.from(shapeNs).sort((a, b) => a - b);

// ---------- throughput ----------
const fullMeanMs = fullBatchMs.reduce((a, b) => a + b, 0) / fullBatchMs.length;
const BUDGET_MS = 1000 / 30;             // 30 Hz decision budget = 33.33 ms
const decisionsPerSec = 1000 / fullMeanMs;

const report = {
  graph: graphPath,
  version: graph.version ?? null,
  nodes: circuit.nodes,
  edges: circuit.edges,
  outputs: circuit.outputs,
  loadMs: +(tLoad1 - tLoad0).toFixed(3),
  batch: { size: BATCH, batches: BATCHES },
  budgetMs: +BUDGET_MS.toFixed(3),
  // headline: batch-timed per-decision latency
  decisionMs: +fullMeanMs.toFixed(4),
  decisionMsSpread: {
    min: +Math.min(...fullBatchMs).toFixed(4),
    median: +median(fullBatchMs).toFixed(4),
    max: +Math.max(...fullBatchMs).toFixed(4),
  },
  circuitMs: +(circBatchMs.reduce((a, b) => a + b, 0) / circBatchMs.length).toFixed(4),
  decisionsPerSec: +decisionsPerSec.toFixed(1),
  headroomVs30Hz: +(BUDGET_MS / fullMeanMs).toFixed(2),
  realtimeFactor: +(decisionsPerSec / 30).toFixed(2),
  // relative shape only (per-call timer overhead inflates absolute values)
  shapeRelative: {
    p50: +pct(shapeSorted, 50).toFixed(0),
    p95: +pct(shapeSorted, 95).toFixed(0),
    p99: +pct(shapeSorted, 99).toFixed(0),
    ratioP99toP50: +(pct(shapeSorted, 99) / Math.max(1, pct(shapeSorted, 50))).toFixed(2),
    note: "microseconds from wrapping every call in performance.now(); absolute values are inflated by timer overhead in this VM — use only for the shape/ratio.",
  },
};

console.log(JSON.stringify(report, null, 2));