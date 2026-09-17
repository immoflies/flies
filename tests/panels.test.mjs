// Regression tests for the Brain Activity panel (public/panels.js).
// Covers: convex-hull correctness, projection stability, offscreen
// edge-layer DPR sizing / CSS-size draw, edge-layer cache invalidation on
// view change, and that renderBrain + frame() run without throwing against a
// minimal mocked window.__FLYJUMP.
//
// Run:  node --test tests/panels.test.mjs
import { readFileSync } from "node:fs";
import test from "node:test";
import "./panels-perf.test.mjs"; // npm test includes the real-atlas operation budget
import assert from "node:assert/strict";

const PANELS_SRC = readFileSync(new URL("../public/panels.js", import.meta.url), "utf8");

// ---------------------------------------------------------------- harness ----

function makeCanvas(width = 300, height = 150) {
  const record = [];
  const ctx = {
    globalAlpha: 1, lineWidth: 1, fillStyle: "#000", strokeStyle: "#000", font: "",
    setTransform: (...a) => record.push(["setTransform", ...a]),
    clearRect: (...a) => record.push(["clearRect", ...a]),
    beginPath: () => record.push(["beginPath"]),
    moveTo: (...a) => record.push(["moveTo", ...a]),
    lineTo: (...a) => record.push(["lineTo", ...a]),
    closePath: () => record.push(["closePath"]),
    stroke: () => record.push(["stroke"]),
    fill: () => record.push(["fill"]),
    arc: (...a) => record.push(["arc", ...a]),
    fillText: (...a) => record.push(["fillText", ...a]),
    drawImage: (img, ...a) => record.push(["drawImage", img, ...a]),
    save() {}, restore() {}, rect: (...a) => record.push(["rect", ...a]),
  };
  const listeners = {};
  const el = { width, height, _record: record, getContext: () => ctx, style: {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    emit: (type, e = {}) => listeners[type]?.(e),
    setPointerCapture() {}, releasePointerCapture() {},
  };
  ctx.canvas = el;
  return el;
}

// Evaluate panels.js in a fresh fake env. panels.js is an IIFE referencing the
// globals window/document/requestAnimationFrame; we inject them as params and
// read the test hook it exposes on window.__PANELS_TEST.
function loadPanels({ devicePixelRatio = 1, elements = {}, flyjump = null } = {}) {
  const rAF = { queue: [] };
  const listeners = {};
  let time = 0;
  const win = {
    devicePixelRatio, __FLYJUMP: flyjump, PointerEvent: function () {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    emit: (type, e = {}) => listeners[type]?.(e),
    fetch: () => Promise.reject(new Error("offline")), // panels must tolerate atlas failure
  };
  const doc = {
    createElement: (tag) => (tag === "canvas" ? makeCanvas() : {}),
    getElementById: (id) => elements[id],
  };
  const instrumented = PANELS_SRC.replace(/\}\)\(\);\s*$/, `window.__PANELS_TEST = { brainGeom, sceneProj, get sceneGeom(){return sceneGeom}, set sceneGeom(v){sceneGeom=v}, renderBrain, convexHull2D: typeof convexHull2D === "function" ? convexHull2D : undefined }; })();`);
  const scope = new Function("window", "document", "requestAnimationFrame", "fetch", instrumented);
  scope(win, doc, (cb) => { rAF.queue.push((ts) => cb(ts ?? (time += 40))); }, win.fetch);
  return { win, doc, rAF, internals: win.__PANELS_TEST || {} };
}

function makeFlyjump() {
  const N_IN = 2, N_HID = 2, N_OUT = 5;
  const W = new Array(N_HID * (N_IN + 1) + N_OUT * (N_HID + 1)).fill(0.1);
  const positions = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [5, 5, 4], [2, 2, -3],
  ];
  return {
    decision: {
      inputs: [0.1, 0.8], hidden: new Array(N_HID).fill(0.3),
      scores: [0.1, 0.2, 0.3, 0.4, 0.5], action: 0,
      activity: new Array(positions.length).fill(0.2),
    },
    weights: W, positions,
    roles: ["input", "interneuron", "output", "input", "interneuron", "output"],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
    inputLabels: ["DNp04", "pIP1"], actions: ["NOOP", "LEFT", "RIGHT", "JUMP", "DUCK"],
    N_IN, N_HID, N_OUT, brainYaw: 0, brainZoom: 1, connected: true,
  };
}

function makeHost(w = 420, h = 300) {
  const el = makeCanvas();
  el.clientWidth = w; el.clientHeight = h;
  return el;
}

const lastDrawImage = (el) => {
  const draws = el._record.filter((c) => c[0] === "drawImage");
  return draws[draws.length - 1];
};

test("pointer/wheel bursts coalesce; redraws stay <=30Hz; release never refines the atlas", () => {
  const brain = makeHost(), J = makeFlyjump();
  const h = loadPanels({ elements: { "brain-scene": brain }, flyjump: J });
  h.win.emit("load");
  h.rAF.queue.shift()(0);                     // baseline frame, no input yet
  const startYaw = J.brainYaw, startBuilds = h.win.__BRAIN_PERF.rebuilds;
  brain.emit("pointerdown", { clientX: 100, pointerId: 7, button: 0 });
  assert.equal(J.brainYaw, startYaw, "no model write on pointerdown");

  // Drag for ~2 s of 60 Hz frames, injecting a 3-event pointer burst per frame
  // (a fast mouse can easily flood 100s of pointermove/s).
  let cursor = 100, frames = 0;
  for (let t = 17; t <= 2000; t += 17) {
    for (let k = 0; k < 3; k++) { cursor += 10; brain.emit("pointermove", { clientX: cursor, pointerId: 7 }); }
    h.rAF.queue.shift()(t);
    frames++;
  }
  const perf = h.win.__BRAIN_PERF;
  assert.ok(perf.inputEvents >= 100, `coalesced a real burst of pointer events (${perf.inputEvents} captured)`);
  const expectedCommits = Math.floor(2000 / 33) + 1;
  assert.ok(perf.inputCommits <= expectedCommits, `commits ${perf.inputCommits} <= 2000/33ms slots (${expectedCommits}) — cohesive, not per-event`);
  assert.ok(perf.rebuilds - startBuilds <= expectedCommits + 1, `layer rebuilds bounded by committed slots (${perf.rebuilds - startBuilds} for ~${frames} frames)`);

  // Release: the next frame settles the final coalesced delta, then a long
  // idle must not do any extra full-resolution build (LOD is identical while
  // dragging/at rest — no hitch on release).
  brain.emit("pointerup", { clientX: cursor, pointerId: 7 });
  h.rAF.queue.shift()(2034);
  assert.ok(Math.abs(J.brainYaw - (startYaw + (cursor - 100) * 0.012)) < 1e-6, "no displacement lost by coalescing");
  const settleBuilds = h.win.__BRAIN_PERF.rebuilds;
  for (let t = 2051; t <= 4100; t += 17) h.rAF.queue.shift()(t);
  assert.equal(h.win.__BRAIN_PERF.rebuilds, settleBuilds, "no post-release rebuild hitches");
  console.log(JSON.stringify({ burstPointerEvents: perf.inputEvents, commits: perf.inputCommits, dragFrames: frames, rebuilds: perf.rebuilds }));
});

test("high-frequency decisions and external rotations cannot bypass the 30Hz panel budget", () => {
  const brain = makeHost(), J = makeFlyjump();
  const h = loadPanels({ elements: { "brain-scene": brain }, flyjump: J });
  for (let t = 0; t < 1000; t++) {
    J.brainYaw = t * 0.01;
    J.decision.inputs[0] = t;
    h.rAF.queue.shift()(t);
  }
  assert.ok(h.win.__BRAIN_PERF.renders <= 30, `render count ${h.win.__BRAIN_PERF.renders} exceeds 30Hz`);
  assert.ok(h.win.__BRAIN_PERF.rebuilds <= 30);
});

test("pointer release delta survives; cancellation never jumps to default coordinates; wheel clamps", () => {
  const brain = makeHost(), J = makeFlyjump();
  const h = loadPanels({ elements: { "brain-scene": brain }, flyjump: J });
  h.win.emit("load");
  brain.emit("pointerdown", { clientX: 100, pointerId: 7, button: 0 });
  brain.emit("pointermove", { clientX: 110, pointerId: 7 });
  brain.emit("pointerup", { clientX: 125, pointerId: 7 });
  h.rAF.queue.shift()(0);
  assert.equal(J.brainYaw, 0.3);
  brain.emit("pointerdown", { clientX: 125, pointerId: 7, button: 0 });
  brain.emit("pointermove", { clientX: 130, pointerId: 7 });
  brain.emit("pointercancel", { clientX: 0, pointerId: 7 });
  h.rAF.queue.shift()(40);
  assert.equal(J.brainYaw, 0.36, "cancel ignores event coordinates");
  for (let i = 0; i < 100; i++) brain.emit("wheel", { deltaY: -1, preventDefault() {} });
  assert.equal(J.brainZoom, 1, "wheel burst is deferred");
  h.rAF.queue.shift()(80);
  assert.equal(J.brainZoom, 3);
});

// ------------------------------------------------------------ convex hull ----

test("convexHull2D: square + interior point -> exact 4 extreme corners", () => {
  const h = loadPanels();
  const hull = h.internals.convexHull2D([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    { x: 5, y: 5 }, { x: 5, y: 0 },
  ]);
  const key = (p) => `${p.x},${p.y}`;
  assert.equal(hull.length, 4, "collinear + interior points excluded");
  assert.deepEqual(hull.map(key).sort(), ["0,0", "0,10", "10,0", "10,10"]);
});

test("convexHull2D: every input lies inside-or-on the returned CCW hull", () => {
  const h = loadPanels();
  const pts = [
    { x: -3, y: 1 }, { x: 5, y: -2 }, { x: 2, y: 6 }, { x: 1, y: 1 },
    { x: 4, y: 3 }, { x: -1, y: -2 }, { x: 0, y: 2 }, { x: 5, y: 5 },
  ];
  const hull = h.internals.convexHull2D(pts);
  assert.ok(hull.length >= 3);
  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  assert.ok(area2 > 0, `CCW (area2=${area2})`);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (const p of pts) {
    const inside = hull.every((_, i) => cross(hull[i], hull[(i + 1) % hull.length], p) >= -1e-9);
    assert.ok(inside, `point ${JSON.stringify(p)} inside hull`);
  }
});

test("convexHull2D: degenerates (1, 2, duplicate, collinear) handled", () => {
  const h = loadPanels();
  assert.equal(h.internals.convexHull2D([{ x: 1, y: 1 }]).length, 1);
  assert.equal(h.internals.convexHull2D([{ x: 0, y: 0 }, { x: 4, y: 3 }]).length, 2);
  const collinear = h.internals.convexHull2D([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 5, y: 5 },
  ]);
  assert.equal(collinear.length, 2, `collinear -> 2 extreme points, got ${collinear.length}`);
});

test("convexHull2D: empty and duplicate-only inputs are degenerate-safe", () => {
  const { convexHull2D } = loadPanels().internals;
  assert.deepEqual(convexHull2D([]), []);
  const dup = convexHull2D([{x:1,y:2},{x:1,y:2}]);
  assert.ok(dup.length <= 2 && dup.every(p => p.x === 1 && p.y === 2),
    "degenerate duplicates stay within the input extremes");
});

test("frame(): DPR, resize, real rotation and graph replacement invalidate the cache", () => {
  const brain = makeHost(), J = makeFlyjump();
  const h = loadPanels({ elements: { 'brain-scene': brain }, flyjump: J });
  h.rAF.queue.shift()();
  const layer = lastDrawImage(brain)[1];
  const builds = () => layer._record.filter(c => c[0] === 'setTransform').length;
  let expected = builds();
  for (const update of [
    () => { h.win.devicePixelRatio = 2; },
    () => { brain.clientWidth = 600; },
    () => { J.brainYaw = 0.001; },        // below this the view is pixel-identical (toFixed(3))
    () => { J.brainZoom = 1.001; },
    () => { J.positions = [[0,0,0],[5,5,5]]; J.edges = [[0,1]]; }, // graph swap (sizes change)
  ]) {
    update(); h.rAF.queue.shift()();
    assert.equal(builds(), ++expected, 'view or graph change rebuilds layer');
  }
  // No further rebuilds when nothing changes.
  for (let i = 0; i < 3; i++) { h.rAF.queue.shift()(); }
  assert.equal(builds(), expected, 'stable view does not rebuild');
});

// ----------------------------------------------------------- projection -----

const centeredGraph = () => ({ ex: 2, ey: 2, ez: 2, mx: 0, my: 0, mz: 0 });
const projAt = (h, g, yaw, zoom, w, hh) => {
  h.internals.sceneGeom = g;
  return h.internals.sceneProj(yaw, zoom, w, hh);
};

test("sceneProj: soma centroid maps to canvas centre for any yaw/zoom", () => {
  const h = loadPanels();
  const G = centeredGraph();
  for (const yaw of [0, 0.6, 1.3, 3.1]) for (const zoom of [0.5, 1, 2]) {
    const p = projAt(h, G, yaw, zoom, 200, 100)(0, 0, 0);
    assert.ok(Math.abs(p.x - 100) < 1e-9, `x centering yaw=${yaw} zoom=${zoom}`);
    assert.ok(Math.abs(p.y - 50) < 1e-9, `y centering yaw=${yaw} zoom=${zoom}`);
  }
});

test("sceneProj: deterministic and matches yaw=0 vs yaw=pi/2 axis swap", () => {
  const h = loadPanels();
  const G = { ex: 10, ey: 10, ez: 10, mx: 1, my: 2, mz: 3 };
  const p0 = projAt(h, G, 0.6, 1.25, 420, 300)(1, 2, 3);
  const p1 = projAt(h, G, 0.6, 1.25, 420, 300)(1, 2, 3);
  assert.deepEqual(p0, p1, "stable across calls");

  const y0 = projAt(h, G, 0, 1, 200, 100)(1 + 5, 2, 3);   // +x at yaw 0
  const y1 = projAt(h, G, Math.PI / 2, 1, 200, 100)(1, 2, 3 + 5); // +z at yaw 90
  assert.ok(Math.abs(y0.x - y1.x) < 1e-9, "x displacement = X at yaw0, Z at yaw90 (same magnitude)");
});

// ------------------------------------------------------------- geometry -----

test("brainGeom: reads [x,y,z] arrays -> per-axis extents + centre", () => {
  const h = loadPanels();
  const g = h.internals.brainGeom({ positions: [[0, 0, 0], [4, 2, 0], [1, -2, 6], [2, 1, 3]] });
  assert.equal(g.ex, 4); assert.equal(g.ey, 4); assert.equal(g.ez, 6);
  assert.equal(g.mx, 2); assert.equal(g.my, 0); assert.equal(g.mz, 3);
});

// ----------------------------------------------------------- sceneProj -------

test("sceneProj: centred and aspect-filling for flat vs elongated scenes", () => {
  const h = loadPanels();
  // flat scene (all z=0): must still fill a WIDE canvas along x
  h.internals.sceneGeom = null;
  const flat = h.internals.brainGeom({ positions: [[-100, 0, 0], [100, 0, 0], [0, 0, 0]] });
  h.internals.sceneGeom = flat;
  const pFlat = h.internals.sceneProj(0, 1, 400, 100)(100, 0, 0);
  // with ey=0, half = hypot(ex,0)/2/aspect*1.22 = 200/4*1.22 = 61; scale=50/61
  assert.ok(Math.abs(pFlat.x - (200 + 100 * (50 / (100 / 4 * 1.22)))) < 1e-6, "x filled by xz extent/aspect");
  // elongated scene: y-extent drives the fit on a square canvas
  const tall = h.internals.brainGeom({ positions: [[0, -100, 0], [0, 100, 0], [0, 0, 0]] });
  h.internals.sceneGeom = tall;
  const pTall = h.internals.sceneProj(0, 1, 200, 200)(0, 100, 0);
  assert.ok(Math.abs(pTall.y - (100 - 100 / 1.22)) < 1e-6, "tall scene reaches the vertical edge (no half-empty panel)");
});

// --------------------------------------------------- edge-layer DPR + draw ----

test("renderBrain: edge layer sized in DEVICE px and drawn at CSS (w,h) size", () => {
  const DPR = 2, W = 420, H = 300;
  const brain = makeHost(W, H);
  const h = loadPanels({ devicePixelRatio: DPR, elements: { "brain-scene": brain }, flyjump: makeFlyjump() });
  h.internals.renderBrain(brain.getContext("2d"), h.win.__FLYJUMP, brain);

  assert.equal(brain.width, W * DPR, "main canvas width = device px");
  assert.equal(brain.height, H * DPR, "main canvas height = device px");

  const [, img, x, y, w, hh] = lastDrawImage(brain);
  assert.equal(x, 0); assert.equal(y, 0);
  assert.equal(w, W, "drawImage width = CSS width (avoids dpr double-scale)");
  assert.equal(hh, H, "drawImage height = CSS height");
  assert.equal(img.width, W * DPR, "edge-layer backing width = device px");
  assert.equal(img.height, H * DPR, "edge-layer backing height = device px");
  assert.deepEqual(img._record.filter((c) => c[0] === "setTransform").map((c) => c[1]), [DPR],
    "edge-layer transform = dpr");
  const clear = img._record.find((c) => c[0] === "clearRect");
  assert.deepEqual([clear[1], clear[2], clear[3], clear[4]], [0, 0, W, H], "clearRect in CSS coords");
});

test("renderBrain: without atlas it draws edges + fallback label, does not throw", () => {
  const brain = makeHost();
  const h = loadPanels({ devicePixelRatio: 1, elements: { "brain-scene": brain }, flyjump: makeFlyjump() });
  h.internals.renderBrain(brain.getContext("2d"), h.win.__FLYJUMP, brain);
  const rec = brain._record;
  assert.ok(rec.some((c) => c[0] === "fillText" && /live cells/.test(c[1])), "fallback/atlas label drawn");
  const layer = lastDrawImage(brain)[1];
  assert.ok(layer._record.some((c) => c[0] === "lineTo"), "circuit edges traced in layer");
});

test("renderBrain: edge layer cached, rebuilt only on rotate/zoom/resize", () => {
  const brain = makeHost();
  const J = makeFlyjump();
  const h = loadPanels({ devicePixelRatio: 1, elements: { "brain-scene": brain }, flyjump: J });
  const ctx = brain.getContext("2d");
  const currentLayer = () => lastDrawImage(brain)[1];

  h.internals.renderBrain(ctx, J, brain);
  const l1 = currentLayer();
  const builds1 = l1._record.filter((c) => c[0] === "setTransform").length;

  h.internals.renderBrain(ctx, J, brain);           // same view
  assert.equal(currentLayer(), l1, "no reallocation");
  assert.equal(l1._record.filter((c) => c[0] === "setTransform").length, builds1, "no re-trace");

  J.brainYaw = 0.9; h.internals.renderBrain(ctx, J, brain);   // rotate
  const l2 = currentLayer();
  assert.equal(l2, l1, "reuse layer allocation after rotate");
  assert.equal(l2._record.filter((c) => c[0] === "setTransform").length, builds1 + 1, "rebuilt exactly once");

  J.brainZoom = 1.5; h.internals.renderBrain(ctx, J, brain);  // zoom
  assert.equal(currentLayer()._record.filter(c => c[0] === "setTransform").length, builds1 + 2, "rebuilt after zoom");

  brain.clientWidth = 640; brain.clientHeight = 360;          // resize
  h.internals.renderBrain(ctx, J, brain);
  const [, , , , w, hh] = lastDrawImage(brain);
  assert.equal(w, 640, "drawImage width tracks resize");
  assert.equal(hh, 360, "drawImage height tracks resize");
});

// ------------------------------------------------ renderBrain / frame smoke ----

test("frame(): renders the brain on view change without re-rendering policy", () => {
  const brain = makeHost();
  const policy = makeHost();
  const kb = makeCanvas();
  const J = makeFlyjump();
  const h = loadPanels({
    devicePixelRatio: 1,
    elements: { "brain-scene": brain, "policy-network": policy, "keyboard-output": kb },
    flyjump: J,
  });

  h.rAF.queue.shift()();
  assert.equal(brain._record.filter((c) => c[0] === "drawImage").length, 1, "first frame brain render");
  const policyCalls = policy._record.length;

  J.brainYaw = 0.42;                        // rotate, same decision
  h.rAF.queue.shift()();
  assert.equal(brain._record.filter((c) => c[0] === "drawImage").length, 2, "brain re-rendered on rotate");
  assert.equal(policy._record.length, policyCalls, "policy NOT re-rendered on view-only change");

  J.decision.inputs[0] = 0.9; J.decision.action = 2;   // decision change
  h.rAF.queue.shift()();
  assert.equal(brain._record.filter((c) => c[0] === "drawImage").length, 3);
  assert.ok(policy._record.length > policyCalls, "policy re-rendered on decision change");
});

test("frame(): renders two frames without throwing at dpr=2", () => {
  const brain = makeHost();
  const policy = makeHost();
  const kb = makeCanvas();
  const J = makeFlyjump();
  const h = loadPanels({
    devicePixelRatio: 2,
    elements: { "brain-scene": brain, "policy-network": policy, "keyboard-output": kb },
    flyjump: J,
  });
  for (let i = 0; i < 2 && h.rAF.queue.length; i++) h.rAF.queue.shift()();
  assert.ok(brain._record.filter((c) => c[0] === "drawImage").length >= 1, "brain drawn");
  assert.ok(typeof kb.innerHTML === "string", "keyboard panel filled");
});