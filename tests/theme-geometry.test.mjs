// theme-geometry.test.mjs — lane alignment, depth clarity, lane-bounded footprints.
// Owns: public/theme.js contract. Vendor physics untouched (1500-tick parity).
import assert from 'node:assert/strict';
import {boot} from './sprites.test.mjs';

const W = 520, H = 680, HORIZON = 176, PLAYER_T = 0.9;
const projHalf = (t) => 16 + 252 * Math.pow(t, 1.62);
const laneSpacing = (t) => projHalf(t) * 0.52;           // vendor laneToX scale
const laneToX = (lane, t) => W / 2 + lane * laneSpacing(t);
const projY = (t) => HORIZON + (H - HORIZON) * t;
const DEPTHS = [0.02, 0.25, 0.5, 0.75, 0.9, 1.05];

// --- RED 1: theme must expose render-only projection helpers -------------
const b = boot();
b.api.startRun();
for (const fn of ['iffLaneX', 'iffRoadEdge', 'iffHazard'])
  assert.equal(typeof b.sb[fn], 'function', `theme must expose ${fn}`);

// --- RED 2: same projection as vendor for every lane at every depth ------
for (const t of DEPTHS) for (const lane of [-1, -0.5, 0, 0.5, 1])
  assert.ok(Math.abs(b.sb.iffLaneX(lane, t) - laneToX(lane, t)) < 1e-6,
    `iffLaneX(${lane},${t}) must equal vendor laneToX`);

// --- RED 3: road edges = 3-lane extents ±1.5 (NOT vendor edgeX ±1.16) ----
for (const t of DEPTHS) for (const side of [-1, 1])
  assert.ok(Math.abs(b.sb.iffRoadEdge(side, t) - (W / 2 + side * 1.5 * laneSpacing(t))) < 1e-6,
    `iffRoadEdge(${side},${t}) must be lane extent ±1.5`);

// --- RED 4: drawn road spans ±1.5 lane extents, dividers at lane ±0.5 ----
b.calls.length = 0;
b.api.drawPath();
const pts = b.calls.map(([x, y]) => [x, y]);
for (const t of [0.1, 0.35, 0.6, 0.85]) {
  const near = (tx, ty, tol = 3) => pts.some(([x, y]) => Math.abs(x - tx) < tol && Math.abs(y - ty) < tol);
  assert.ok(near(b.sb.iffRoadEdge(1, t), projY(t), 4),
    `road right edge must reach lane extent +1.5 at depth t=${t}`);
  assert.ok(near(b.sb.iffRoadEdge(-1, t), projY(t), 4),
    `road left edge must reach lane extent -1.5 at depth t=${t}`);
  // lane divider: a road marking at lane +0.5 and -0.5 (NOT lane ±1)
  assert.ok(near(b.sb.iffLaneX(0.5, t), projY(t)) || near(b.sb.iffLaneX(-0.5, t), projY(t)),
    `lane divider must sit at lane ±0.5 at depth t=${t}`);
}

// --- RED 5: perspective depth markers: horizontal rings at many depths ---
const ys = new Map();
for (let i = 1; i < b.calls.length; i++) {
  const [x1, y1] = b.calls[i - 1], [x2, y2] = b.calls[i];
  if (Math.abs(y1 - y2) < 0.5 && Math.abs(x2 - x1) > 2 && y1 > HORIZON + 2) {
    if (!ys.has(y1)) ys.set(y1, Math.abs(x2 - x1));
  }
}
assert.ok(ys.size >= 6, `drawPath must draw horizontal depth markers at >=6 distinct depths (got ${ys.size})`);

// --- RED 6: hazard footprints lane-bounded at ALL depths -----------------
const hz = { jump: b.sb.iffHazard('jump'), duck: b.sb.iffHazard('duck'), move: b.sb.iffHazard('move') };
for (const t of [0.05, 0.3, 0.9, 1.1]) {
  const s = projHalf(t) / projHalf(PLAYER_T);
  const halfLane = 0.5 * laneSpacing(t);            // px half-width of one lane
  for (const [kind, h] of Object.entries(hz))
    assert.ok(h.width * s <= 2 * halfLane * 0.95,
      `${kind} footprint ${(h.width * s).toFixed(1)}px must fit inside its lane (${(2 * halfLane).toFixed(1)}px) at t=${t}`);
}
// duck-hazard box stays low enough to read as "fly under the bird"
assert.ok(hz.duck.bottom >= 40 && hz.duck.width >= 60 && hz.duck.width <= 84, 'duck hazard: bird with clear gap, lane-bounded width');
assert.ok(hz.move.top < 128, 'wooden wall must be slimmer than the old 128px blocker so depth stays visible');
assert.ok(hz.jump.top <= 30 && hz.jump.bottom === 0, 'pond is a ground-level low patch');

// --- RED 7: bird body floats above ground, shadow on ground contact ------
b.calls.length = 0;
b.api.drawObstacle({ kind: 'ptero', avoid: 'duck', lane: 0, t: 0.5, seed: 1 });
const gp = projY(0.5);
const bodyAbove = b.calls.some(([x, y]) => y < gp - 8 * (projHalf(0.5) / projHalf(PLAYER_T)));
const groundShadow = b.calls.some(([x, y]) => Math.abs(y - (gp + 4 * (projHalf(0.5) / projHalf(PLAYER_T)))) < 2);
assert.ok(bodyAbove, 'flying bird body must be drawn above the ground line');
assert.ok(groundShadow, 'flying bird must cast a ground-contact shadow at its lane depth');

// --- RED 8: truthful depth ordering vs the player plane ------------------
b.calls.length = 0;
b.api.drawObstacle({ kind: 'rock', avoid: 'jump', lane: 0, t: 0.3, seed: 1 });
assert.ok(b.calls.every(([x, y]) => y <= projY(0.3) + 1), 'far hazards drawn above (before) player ground line');
b.calls.length = 0;
b.api.drawObstacle({ kind: 'rock', avoid: 'jump', lane: 0, t: 1.05, seed: 1 });
assert.ok(b.calls.some(([x, y]) => y > projY(PLAYER_T)), 'passed hazards drawn below (after) player ground line');

console.log('PASS: theme geometry — vendor-matched projection, ±1.5 road extents, ±0.5 dividers, depth markers, lane-bounded hazards, ground-contact guides, truthful ordering');
