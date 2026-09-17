// Connectome circuit core — ported from cobanov/flyjump (src/lib/connectome.ts),
// reused under its attribution terms (see ATTRIBUTION.md).
// The fixed 80-cell MaleCNS circuit is a fixed nonlinear feature transform;
// only the readout (see lib/readout.mjs) is trained.
import graph from "../src/data/connectome.json" with { type: "json" };

export const DYNAMICS = { iterations: 3, leak: 0.7, gain: 1.4, outputGain: 4 };
const count = graph.nodes.length;

const totals = new Float64Array(count);
for (const [pre, post, contacts] of graph.edges)
  totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
const edges = graph.edges.map(([pre, post, contacts]) => [
  pre,
  post,
  totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0,
]);

export class Connectome {
  constructor() {
    this.activity = new Float64Array(count);
    this.scratch = new Float64Array(count);
    this.drive = new Float64Array(count);
  }
  step(inputs, ablated = false) {
    const n = count;
    if (ablated) {
      this.activity.fill(0);
      return graph.outputs.map(() => 0);
    }
    this.drive.fill(0);
    for (const [cell, channel] of graph.inputs)
      this.drive[cell] = 2 * (inputs[channel] - 0.5);
    const { iterations, leak, gain } = DYNAMICS;
    const act = this.activity, scr = this.scratch, dri = this.drive;
    for (let t = 0; t < iterations; t++) {
      scr.set(dri);
      for (let e = 0; e < edges.length; e++) {
        const [pre, post, w] = edges[e];
        scr[post] += gain * w * act[pre];
      }
      for (let i = 0; i < n; i++)
        act[i] = (1 - leak) * act[i] + leak * Math.tanh(scr[i]);
    }
    const out = new Array(graph.outputs.length);
    for (let i = 0; i < out.length; i++)
      out[i] = act[graph.outputs[i]] * DYNAMICS.outputGain;
    return out;
  }
}

export { graph as CIRCUIT };