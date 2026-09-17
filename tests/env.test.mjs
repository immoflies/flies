import { Connectome, DYNAMICS, CIRCUIT } from "../lib/connectome.mjs";
import { initParams, forward, argmax, PARAM_COUNT, N_OUT } from "../lib/readout.mjs";
import { rollout, encodeObs, FPS } from "../lib/env.mjs";
import { loadGame } from "../lib/game-adapter.mjs";

console.log("circuit nodes:", CIRCUIT.nodes.length, "edges:", CIRCUIT.edges.length, "inputs:", CIRCUIT.inputs.length, "outputs:", CIRCUIT.outputs.length);
console.log("PARAM_COUNT:", PARAM_COUNT, "N_OUT:", N_OUT);

// connectome fires a stable, bounded output
const c = new Connectome();
const out = c.step([0.5,0,0,0,0,0.5,0.2,0.5]);
console.log("connectome out (16):", out.slice(0,5).map(x=>x.toFixed(3)), "...len", out.length);

// a random agent: rollout an episode, ensure it runs & terminates
const t0 = Date.now();
const r = rollout(initParams(), { seed: 42, decisionEvery: 2, maxSeconds: 30 });
console.log("random rollout:", { elapsed: +r.elapsed.toFixed(2), score: r.score, crashed: r.crashed, ms: Date.now()-t0 });