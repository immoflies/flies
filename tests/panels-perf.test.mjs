// Deterministic operation-budget regression for the Brain Activity panel.
// Loads the REAL whole-brain MaleCNS atlas (public/data/brain-atlas/*.bin,
// 124,289 shown somata) and proves the renderer uses a bounded representative
// LOD — never a full 124k-dot path per view change — so dragging/zooming
// cannot build an O(atlas) canvas path every frame.
//
// Run:  node --test tests/panels-perf.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PANELS_SRC = readFileSync(join(ROOT, "public", "panels.js"), "utf8");

// The exporter (public/data/brain-atlas/manifest.json) declares these.
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "public", "data", "brain-atlas", "manifest.json"), "utf8"));
const COUNT = MANIFEST.count; // 140024 total
const ATLAS_TARGET = 15000;   // must stay in sync with ATLAS_LOD_TARGET in panels.js

function loadAtlasBuffers() {
  const P = new Float32Array(readFileSync(join(ROOT, "public", "data", "brain-atlas", "positions.bin")).buffer);
  const G = new Uint8Array(readFileSync(join(ROOT, "public", "data", "brain-atlas", "groups.bin")).buffer);
  assert.equal(P.length, COUNT * 3, "positions.bin byte layout matches manifest count");
  assert.equal(G.length, COUNT, "groups.bin byte layout matches manifest count");
  return { P, G };
}

function countingCtx() {
  const c = { rect: 0, fill: 0, begin: 0, arcs: 0 };
  return {
    _c: c,
    save() {}, restore() {},
    setTransform() {}, clearRect() {}, globalAlpha: 1, lineWidth: 1,
    fillStyle: "", strokeStyle: "", font: "",
    beginPath() { c.begin++; }, moveTo() {}, lineTo() {},
    rect() { c.rect++; }, fill() { c.fill++; },
    arc() { c.arcs++; }, fillText() {}, stroke() {}, drawImage() {},
    canvas: { width: 0, height: 0 },
  };
}

// Evaluate panels.js IIFE and expose internals for deterministic probing.
function loadPanels({ buffers, devicePixelRatio = 1, fetcher } = {}) {
  const win = {
    devicePixelRatio,
    __FLYJUMP: null,
    addEventListener: () => {},
    fetch: fetcher || (() => Promise.reject(new Error("offline"))),
  };
  const doc = { createElement: () => makeCanvasStub(), getElementById: () => undefined };
  const instrumented = PANELS_SRC.replace(
    /\}\)\(\);\s*$/,
    `window.__PANELS_TEST = {
      buildAtlasLOD, drawAtlasCloud, ingestAtlas,
      get sceneGeom() { return sceneGeom; }, set sceneGeom(v) { sceneGeom = v; },
      get atlas() { return atlas; }, set atlas(v) { atlas = v; },
      get brainPerf() { return brainPerf; },
      get edgeLayer() { return edgeLayer; },
      renderBrain, brainGeom, sceneProj,
    }; })();`
  );
  const rAF = { q: [] };
  new Function("window", "document", "requestAnimationFrame", "fetch", instrumented)(win, doc, (cb) => rAF.q.push(cb), win.fetch);
  return {
    win, rAF,
    internals: win.__PANELS_TEST,
    // ingest the real atlas (equivalent to what loadAtlas does on fetch success)
    ingest: () => win.__PANELS_TEST.ingestAtlas(buffers.P, buffers.G, COUNT),
    latchAtlas: () => win.__PANELS_TEST.atlas,
  };
}
function makeCanvasStub(w = 0, h = 0) {
  const c = countingCtx();
  const el = { width: w, height: h, _c: c, _record: [], getContext: () => c };
  return el;
}

test("real atlas fetch/ingest succeeds and missing or malformed data enables fallback", async () => {
  const fetcher = async url => {
    // panels.js is served from /runner/, so its fetches start with ../ —
    // normalize to a public/ path before reading from disk.
    const data = readFileSync(join(ROOT, "public", url.replace(/^(?:\.\.\/)+/, '')));
    return { json: async () => JSON.parse(data.toString()), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  };
  const h = loadPanels({ fetcher });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.win.__ATLAS_DEBUG.shown, 124289);
  assert.equal(h.internals.atlas.lod.lodCount, 2470);
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => ({ json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(0) })]) {
    const failed = loadPanels({ fetcher });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failed.internals.atlas, false, "failure ends loading state and enables circuit-only fallback");
  }
});

test("buildAtlasLOD: output is strictly bounded and deterministic over the real 124k atlas", () => {
  const { P, G } = loadAtlasBuffers();
  const h = loadPanels({ buffers: { P, G } });
  h.ingest();

  const perf = h.internals.brainPerf;
  assert.equal(perf.atlasCount, COUNT, "telemetry records full atlas count");

  // Deterministic: two independent builds agree exactly (stable ordering).
  const a = h.internals.buildAtlasLOD(P, G, COUNT, ATLAS_TARGET);
  const b = h.internals.buildAtlasLOD(P, G, COUNT, ATLAS_TARGET);
  assert.equal(a.lodCount, b.lodCount, "deterministic representative count");
  assert.deepEqual(Array.from(a.lodP), Array.from(b.lodP), "deterministic representative coordinates");
  assert.deepEqual(Array.from(a.lodG), Array.from(b.lodG), "deterministic representative groups");

  // Operation budget: the per-rebuild path is O(lod), never O(atlas).
  assert.ok(a.lodCount <= ATLAS_TARGET, `lodCount ${a.lodCount} <= target ${ATLAS_TARGET}`);
  assert.ok(a.lodCount < COUNT * 0.05, `lodCount ${a.lodCount} << atlas ${COUNT} (bounded representative LOD)`);
  assert.ok(a.lodCount > 400, `lodCount ${a.lodCount} stays rich enough to preserve whole-brain shape`);
  assert.equal(perf.lodCount, a.lodCount, "telemetry reflects the loaded LOD");
});

test("buildAtlasLOD: preserves the whole-brain shape (extents, per-group coverage)", () => {
  const { P, G } = loadAtlasBuffers();
  const h = loadPanels({ buffers: { P, G } });
  h.ingest();
  const { atlas, sceneGeom } = h.internals;

  // LOD extents span ≥ 99% of the shown brain on every axis (cells sample
  // the full volume, so the silhouette is preserved).
  const shownLo = [1e12, 1e12, 1e12], shownHi = [-1e12, -1e12, -1e12];
  for (let i = 0; i < COUNT; i++) {
    if (G[i] >= 3) continue;
    for (let k = 0; k < 3; k++) {
      const v = P[i * 3 + k];
      if (v < shownLo[k]) shownLo[k] = v;
      if (v > shownHi[k]) shownHi[k] = v;
    }
  }
  const L = atlas.lod;
  const lodLo = [1e12, 1e12, 1e12], lodHi = [-1e12, -1e12, -1e12];
  for (let i = 0; i < L.lodCount; i++) {
    for (let k = 0; k < 3; k++) {
      const v = L.lodP[i * 3 + k];
      if (v < lodLo[k]) lodLo[k] = v;
      if (v > lodHi[k]) lodHi[k] = v;
    }
  }
  for (let k = 0; k < 3; k++) {
    const full = shownHi[k] - shownLo[k];
    const lod = lodHi[k] - lodLo[k];
    assert.ok(lod >= full * 0.99, `axis ${k} LOD extent ${lod.toFixed(1)} spans ≥99% of brain extent ${full.toFixed(1)}`);
  }

  // Every shown group (optic 0, central 1, descending 2) survives the LOD.
  const groups = new Set(Array.from(L.lodG));
  for (const g of [0, 1, 2]) assert.ok(groups.has(g), `group ${g} represented in LOD`);

  // sceneGeom matches the atlas's own stated brain bounds (native space).
  const nb = MANIFEST.brainNativeBounds;
  assert.ok(Math.abs(sceneGeom.ex - (nb.max[0] - nb.min[0])) < 400, "optic/central extents width ok");
});

test("drawAtlasCloud: emits exactly the bounded LOD rects, never the full atlas path", () => {
  const { P, G } = loadAtlasBuffers();
  const h = loadPanels({ buffers: { P, G } });
  h.ingest();
  const L = h.internals.atlas.lod;

  const c = countingCtx();
  h.internals.drawAtlasCloud(c, 0.6, 1.25, 500, 300);

  // One rect per representative point; the full 124k atlas is never traced.
  assert.equal(c._c.rect, L.lodCount, "rect path size == LOD size (bounded), not atlas size");
  assert.equal(c._c.fill, 3, "three group fills preserve the optic/central/descending layering");
  assert.ok(c._c.rect < COUNT * 0.05, `per-frame rects ${c._c.rect} ≪ atlas ${COUNT}`);
});

test("renderBrain + simulated drag: cumulative build work stays O(lod+edges+nodes), image clean at DPR 2", () => {
  const { P, G } = loadAtlasBuffers();
  // A minimal but realistic live graph (80 cells, ~646 edges) like live.js.
  const N = 80;
  const positions = Array.from({ length: N }, (_, i) => [58238 + i * 97, 22234 + (i * 131) % 9000, 36276 + (i * 67) % 4000]);
  const roles = Array.from({ length: N }, (_, i) => (i < 4 ? "output" : i < 20 ? "interneuron" : "input"));
  const edges = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i * 7 + j * 13) % 9 === 0) edges.push([i, j]);
  const J = {
    decision: {
      inputs: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      hidden: new Array(12).fill(0.3), scores: [0.1, 0.2, 0.3, 0.4, 0.5], action: 0,
      activity: new Array(N).fill(0.2),
    },
    weights: new Array(12 * 18 + 5 * 13).fill(0.05),
    positions, roles, edges,
    inputLabels: Array.from({ length: 16 }, (_, i) => "DN" + i),
    actions: ["NOOP", "LEFT", "RIGHT", "JUMP", "DUCK"],
    N_IN: 16, N_HID: 12, N_OUT: 5, connected: true,
  };

  const brain = makeCanvasStub(0, 0);
  brain.clientWidth = 500; brain.clientHeight = 300;
  const buf = loadAtlasBuffers();
  const h = loadPanels({ buffers: buf, devicePixelRatio: 2 });
  h.ingest();
  const ctx = brain.getContext("2d");
  ctx.canvas = brain;
  h.win.__FLYJUMP = J;

  // Current baseline: a DRAG of 30 frames (yaw changes every frame) without LOD
  // would re-trace the full 124k atlas each frame (3.7M rects total). With the
  // LOD the per-frame and cumulative rect budget must stay O(lod).
  const DRAG_FRAMES = 30;
  let prevLayerRects = 0;
  for (let f = 0; f < DRAG_FRAMES; f++) {
    J.brainYaw = 0.6 + f * 0.012;          // drag: new view every frame
    J.brainZoom = 1.05;
    h.internals.renderBrain(ctx, J, brain);
    const layer = h.internals.edgeLayer;
    const added = layer._c._c.rect - prevLayerRects;
    // Number of rects added to the offscreen layer equals one LOD-sized build.
    assert.ok(added <= h.internals.atlas.lod.lodCount + 2, `frame ${f} layer rects ${added} bounded by LOD`);
    prevLayerRects = layer._c._c.rect;
  }
  assert.equal(prevLayerRects, DRAG_FRAMES * h.internals.atlas.lod.lodCount);
  assert.equal(ctx._c.arcs, DRAG_FRAMES * (N + 4), "all 80 cells and four output rings drawn every frame");
  assert.equal(brain.width, 1000);
  assert.equal(h.internals.edgeLayer.height, 600);
  console.log(JSON.stringify({ atlasShown: MANIFEST.brainCount, lod: h.internals.atlas.lod.lodCount, dragFrames: DRAG_FRAMES, rects: prevLayerRects, baselineRects: DRAG_FRAMES * MANIFEST.brainCount }));

  // Telemetry is exposed for parent measurement.
  assert.ok(h.win.__BRAIN_PERF, "window.__BRAIN_PERF published");
  assert.equal(h.win.__BRAIN_PERF.lodCount, h.internals.atlas.lod.lodCount);
  assert.ok(h.win.__BRAIN_PERF.rebuilds >= DRAG_FRAMES, "rebuild counter reflects the drag");
});