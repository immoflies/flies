// Brain: exact 80-cell MaleCNS dynamics (ported from fruitflyweb/lib/connectome.mjs)
// Runner readout utilities below are retained for reference, not used by Saber.
// Pure math for the controller so it is unit-testable in Node without a browser.

export const ACTIONS = ['NOOP', 'LEFT', 'RIGHT', 'JUMP', 'DUCK'];
const N_IN = 16, N_HID = 12, N_OUT = 5;

export function readoutForward(params, x) {
  const h = new Float64Array(N_HID); let k = 0;
  for (let i = 0; i < N_HID; i++) {
    let a = 0; for (let j = 0; j < N_IN; j++) a += params[k++] * x[j];
    a += params[k++]; h[i] = Math.tanh(a);
  }
  const o = new Float64Array(N_OUT);
  for (let i = 0; i < N_OUT; i++) {
    let a = 0; for (let j = 0; j < N_HID; j++) a += params[k++] * h[j];
    a += params[k++]; o[i] = a;
  }
  return o;
}

export class Brain {
  constructor(graph, canvas) {
    this.graph = graph; this.canvas = canvas;
    this.activity = new Float64Array(graph.nodes.length);
    this.drive = new Float64Array(graph.nodes.length);
    this.scratch = new Float64Array(graph.nodes.length);
    const totals = new Float64Array(graph.nodes.length);
    for (const [a, b, w] of graph.edges) totals[b] += w * Math.abs(graph.nodes[a].sign);
    this.edges = graph.edges.map(([a, b, w]) => [a, b, totals[b] ? w * graph.nodes[a].sign / totals[b] : 0]);
  }
  step(inputs) {
    const a = this.activity, s = this.scratch, d = this.drive;
    d.fill(0);
    for (const [cell, ch] of this.graph.inputs) d[cell] = 2 * (inputs[ch] - .5);
    for (let t = 0; t < 3; t++) {
      s.set(d);
      for (const [pre, post, w] of this.edges) s[post] += 1.4 * w * a[pre];
      for (let i = 0; i < a.length; i++) a[i] = .3 * a[i] + .7 * Math.tanh(s[i]);
    }
    return this.graph.outputs.map(i => a[i] * 4);
  }
  draw(w = this.canvas?.width, h = this.canvas?.height) {
    if (!this.canvas) return;
    const c = this.canvas, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < this.activity.length; i++) {
      const a = this.activity[i];
      ctx.fillStyle = a > 0 ? `rgba(76,224,169,${.15 + Math.abs(a) * .85})` : `rgba(118,146,237,${.15 + Math.abs(a) * .85})`;
      ctx.fillRect(i % 40 * (w / 40) + 3, Math.floor(i / 40) * h / 2 + 8, w / 40 - 6, h / 2 - 14);
    }
  }
}

export class Controller {
  constructor(graph, params) { this.brain = new Brain(graph, null); this.params = Float64Array.from(params); }
  // inputs: 8-vector senses -> {left,right,noop,logits,outs}
  decide(inputs) {
    const outs = this.brain.step(inputs);
    const lg = readoutForward(this.params, outs);
    return { left: lg[1], right: lg[2], noop: lg[0], logits: Array.from(lg), outs };
  }
}

// Sensory encoder: turns per-lane fly note urgency (pure) into the 8 connectome channels.
// Chan map: 0 left-urg,1 left-imminent,2 (spare),3 mid-urg,4 (spare),5 right-urg,6 right-imminent,7 beat.
export function encodeSenses(notes, hit, win, beat) {
  const inp = new Array(8).fill(0);
  for (const n of notes) {
    if (n.done || n.sliced || n.z > hit + 0.2) continue;
    const u = Math.max(0, Math.min(1, (n.z + 46) / (hit + 46)));
    if (n.lane === 0) { inp[0] = Math.max(inp[0], u); inp[1] = Math.max(inp[1], n.z > hit ? u : u * 0.45); }
    else if (n.lane === 1) { inp[3] = Math.max(inp[3], u); }
    else { inp[5] = Math.max(inp[5], u); inp[6] = Math.max(inp[6], n.z > hit ? u : u * 0.45); }
  }
  inp[7] = beat;
  return inp;
}