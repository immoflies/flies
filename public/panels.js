// panels.js — live "Decision Network", "Keyboard Output", "Brain Activity" panels.
// Canvas 2D renderers driven off window.__FLYJUMP. The brain's circuit edges are
// rasterized once into an offscreen layer and only re-traced on rotation/zoom;
// nodes are redrawn only when the decision changes. Mirrors flyjump's
// PolicyNetwork + BrainScene panels (dark, mono, signed green/white).
(function () {
  "use strict";

  const GREEN = "#43d17e", NEGATIVE = "#d2d2d2", DIM = "#334239",
    INK = "#eeeeee", MUTED = "#a0aaa3", FAINT = "#6e8074";
  const MONO = '12px ui-monospace,Menlo,Consolas,monospace';
  const sign = (v) => (v >= 0 ? GREEN : NEGATIVE);
  const fmt = (v, n = 2) => v.toFixed(n);
  // Dark-canvas green/monochrome atlas: the whole-brain background cloud is a
  // subtle dark-green silhouette (three shades for the optic/central/descending
  // layers) so the bright green/white live circuit cells pop on top. The site
  // is white/black/green; no saturated blue/tan/gold bleeding in from the raw
  // atlas group colors.
  const ATLAS_COL = ["#1c5b40", "#26523f", "#2f5f4a"]; // optic, central, descending

  function canvas(ctx, host, ratio) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = host.clientWidth || 420;
    const h = host.clientHeight || (ratio ? w / ratio : w);
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (ctx.canvas.width !== bw || ctx.canvas.height !== bh) { ctx.canvas.width = bw; ctx.canvas.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { w, h, dpr };
  }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function dot(ctx, x, y, r, fill, op) {
    ctx.globalAlpha = op; ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }

  // Andrew's monotone chain: 2D convex hull of an array of {x,y}. Returns the
  // hull vertices in counter-clockwise order (no repeated closing point).
  // Interior, duplicate and collinear boundary points are excluded.
  // (Retained for potential future use; the panel now renders the whole-brain
  //  atlas cloud via drawAtlasCloud, not a subset hull.)
  function convexHull2D(pts) {
    if (pts.length <= 2) return pts.slice();
    const sorted = pts.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let i = 0; i < sorted.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) lower.pop();
      lower.push(sorted[i]);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) upper.pop();
      upper.push(sorted[i]);
    }
    lower.pop(); upper.pop();          // remove the duplicated first/last point
    return lower.concat(upper);
  }

  // --------------------------- Decision Network ------------------------------
  function renderPolicy(ctx, J, host) {
    const d = J.decision, W = J.weights;
    const { w, h } = canvas(ctx, host, 4 / 3);
    const N_IN = J.N_IN, N_HID = J.N_HID, N_OUT = J.N_OUT;
    const W1 = (a, i) => W[a * (N_IN + 1) + i];                     // input->hidden
    const W2 = (a, x) => W[N_HID * (N_IN + 1) + a * (N_HID + 1) + x]; // hidden->action
    const ix = 118, hx = w * 0.5, ox = w - 96;
    const inputY = (i) => 28 + i * (h - 64) / N_IN;
    const hiddenY = (a) => 36 + a * (h - 72) / N_HID;
    const outputY = (a) => a === N_OUT - 1 ? h - 24 : 70 + a * (h - 118) / (N_OUT - 1);

    ctx.lineWidth = 1;
    for (let i = 0; i < N_IN; i++) for (let a = 0; a < N_HID; a++) {
      const c = d.inputs[i] * W1(a, i);
      ctx.strokeStyle = sign(c); ctx.globalAlpha = 0.04 + Math.min(0.5, Math.abs(c) * 0.12);
      line(ctx, ix, inputY(i), hx, hiddenY(a));
    }
    for (let a = 0; a < N_HID; a++) for (let o = 0; o < N_OUT; o++) {
      const c = d.hidden[a] * W2(o, a), chosen = o === d.action;
      ctx.strokeStyle = sign(c);
      ctx.globalAlpha = chosen ? 0.45 + Math.min(0.5, Math.abs(c) * 0.4) : 0.05 + Math.min(0.45, Math.abs(c) * 0.15);
      ctx.lineWidth = chosen ? 2.2 : 1;
      line(ctx, hx, hiddenY(a), ox, outputY(o));
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;

    ctx.fillStyle = MUTED; ctx.font = MONO;
    ctx.fillText("CIRCUIT OUT", 12, 14);
    ctx.fillText("HIDDEN", hx - 26, 14);
    ctx.fillText("ACTIONS", ox + 10, 14);

    for (let i = 0; i < N_IN; i++) {
      const v = d.inputs[i], y = inputY(i);
      ctx.fillStyle = FAINT; ctx.font = `9px ${MONO.split("px")[1]}`;
      ctx.fillText(String(J.inputLabels[i]).slice(0, 8), 12, y + 3);
      ctx.fillStyle = MUTED; ctx.textAlign = "right";
      ctx.fillText(fmt(v), ix - 10, y + 3); ctx.textAlign = "left";
      dot(ctx, ix, y, 4.5, sign(v), 0.2 + Math.min(0.8, Math.abs(v)));
    }
    ctx.font = MONO;
    for (let a = 0; a < N_HID; a++) dot(ctx, hx, hiddenY(a), 5, sign(d.hidden[a]), 0.12 + Math.abs(d.hidden[a]) * 0.85);
    for (let o = 0; o < N_OUT; o++) {
      const y = outputY(o), chosen = o === d.action;
      dot(ctx, ox, y, chosen ? 9 : 6, chosen ? GREEN : DIM, 1);
      ctx.fillStyle = chosen ? INK : MUTED; ctx.font = `bold ${MONO}`;
      ctx.fillText(J.actions[o].toUpperCase() + (chosen ? "  ▶" : ""), ox + 14, y - 4);
      ctx.fillStyle = FAINT; ctx.font = MONO;
      ctx.fillText(fmt(d.scores[o], 3), ox + 14, y + 14);
    }
    ctx.fillStyle = GREEN; ctx.font = `11px ${MONO.split("px")[1]}`;
    ctx.fillText(`${J.actions[d.action]} selected`, 12, h - 8);
    ctx.fillStyle = FAINT; ctx.textAlign = "right";
    ctx.fillText(`${N_IN} → ${N_HID} → ${N_OUT} · ${W.length} params · 30/s`, w - 12, h - 8);
    ctx.textAlign = "left";
  }

  // ----------------------------- Brain Activity ------------------------------
  let edgeLayer = null, geom_ = null, cachedEdges = null;
  function brainGeom(J) {
    const P = J.positions, a = [1e12, -1e12, 1e12, -1e12, 1e12, -1e12];
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p[0] < a[0]) a[0] = p[0]; if (p[0] > a[1]) a[1] = p[0];
      if (p[1] < a[2]) a[2] = p[1]; if (p[1] > a[3]) a[3] = p[1];
      if (p[2] < a[4]) a[4] = p[2]; if (p[2] > a[5]) a[5] = p[2];
    }
    return {
      ex: a[1] - a[0], ey: a[3] - a[2], ez: a[5] - a[4],
      mx: (a[0] + a[1]) / 2, my: (a[2] + a[3]) / 2, mz: (a[4] + a[5]) / 2,
    };
  }

  // ---- Whole-brain MaleCNS atlas: spatial representatives of traced somata
  // show the whole brain's shape; all circuit cells are drawn
  // brightly on top. Data: public/data/brain-atlas/* (male-cns:v1.0, CC BY 4.0). ----
  let atlas = null, sceneGeom = null;
  const ATLAS_LOD_TARGET = 15000;
  const brainPerf = window.__BRAIN_PERF = {
    atlasCount: 0, shown: 0, lodCount: 0, maxAtlasPoints: ATLAS_LOD_TARGET,
    rebuilds: 0, renders: 0, atlasRects: 0, lastBuildMs: 0, maxBuildMs: 0,
    inputEvents: 0, inputCommits: 0, maxHz: 30,
  };

  // One measured soma per occupied 3D voxel AND anatomical group, plus each
  // group's six extreme somata. Unlike a stride through ID-sorted data this
  // covers both optic lobes, sparse descending cells, and the central volume.
  // Fixed grid capacity bounds work even if the source atlas grows. Build once
  // at load; use the SAME LOD while dragging and at rest (no release hitch).
  function buildAtlasLOD(P, G, count, target = ATLAS_LOD_TARGET) {
    const bounds = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    const extremes = Array.from({ length: 3 }, () => new Int32Array(6).fill(-1));
    let shown = 0;
    for (let i = 0; i < count; i++) {
      const g = G[i];
      if (g >= 3) continue;
      shown++;
      for (let k = 0; k < 3; k++) {
        const v = P[i * 3 + k];
        if (!Number.isFinite(v)) throw new Error("Invalid atlas coordinate");
        bounds[k * 2] = Math.min(bounds[k * 2], v);
        bounds[k * 2 + 1] = Math.max(bounds[k * 2 + 1], v);
        for (let side = 0; side < 2; side++) {
          const slot = k * 2 + side, old = extremes[g][slot];
          if (old < 0 || (side ? v > P[old * 3 + k] : v < P[old * 3 + k])) extremes[g][slot] = i;
        }
      }
    }
    if (!shown) throw new Error("Empty brain atlas");
    const n = Math.max(1, Math.floor(Math.cbrt((target - 18) / 3)));
    const cells = new Int32Array(3 * n * n * n).fill(-1);
    const step = [0, 1, 2].map(k => n / Math.max(1, bounds[k * 2 + 1] - bounds[k * 2]));
    for (let i = 0; i < count; i++) {
      if (G[i] >= 3) continue;
      const x = Math.min(n - 1, Math.floor((P[i * 3] - bounds[0]) * step[0]));
      const y = Math.min(n - 1, Math.floor((P[i * 3 + 1] - bounds[2]) * step[1]));
      const z = Math.min(n - 1, Math.floor((P[i * 3 + 2] - bounds[4]) * step[2]));
      const slot = ((G[i] * n + z) * n + y) * n + x;
      if (cells[slot] < 0) cells[slot] = i;
    }
    const selected = new Set();
    for (const i of cells) if (i >= 0) selected.add(i);
    for (const group of extremes) for (const i of group) if (i >= 0) selected.add(i);
    const indices = [...selected].sort((a, b) => G[a] - G[b] || a - b);
    const lodP = new Float32Array(indices.length * 3), lodG = new Uint8Array(indices.length);
    const offsets = [0, 0, 0, 0];
    indices.forEach((i, j) => {
      lodP.set(P.subarray(i * 3, i * 3 + 3), j * 3);
      lodG[j] = G[i]; offsets[G[i] + 1]++;
    });
    for (let g = 1; g < 4; g++) offsets[g] += offsets[g - 1];
    return { lodP, lodG, lodCount: indices.length, offsets, bounds, shown };
  }

  function ingestAtlas(P, G, count) {
    if (!Number.isSafeInteger(count) || count <= 0 || P.length !== count * 3 || G.length !== count) throw new Error("Invalid atlas buffers");
    const lod = buildAtlasLOD(P, G, count), a = lod.bounds;
    atlas = { count, lod }; // release full-resolution buffers after preprocessing
    sceneGeom = { ex: a[1] - a[0], ey: a[3] - a[2], ez: a[5] - a[4], mx: (a[0] + a[1]) / 2, my: (a[2] + a[3]) / 2, mz: (a[4] + a[5]) / 2 };
    Object.assign(brainPerf, { atlasCount: count, shown: lod.shown, lodCount: lod.lodCount });
    window.__ATLAS_DEBUG = { count, shown: lod.shown, lodCount: lod.lodCount };
  }

  function loadAtlas() {
    try {
      fetch("../data/brain-atlas/manifest.json").then((r) => r.json()).then((m) => {
        return Promise.all([
          fetch("data/brain-atlas/" + m.files.positions).then((r) => r.arrayBuffer()),
          fetch("data/brain-atlas/" + m.files.groups).then((r) => r.arrayBuffer()),
        ]).then(([pb, gb]) => {
          const count = m.count;
          const P = new Float32Array(pb), G = new Uint8Array(gb);
          if (P.length !== count * 3 || G.length !== count) throw new Error("Invalid atlas buffers");
          return [P, G, count];
        }).then((arg) => {
          if (!arg) return;
          ingestAtlas(arg[0], arg[1], arg[2]); // preprocess once -> bounded LOD
        });
      }).catch(() => { atlas = false; }); // fetch failed -> circuit-only fallback
    } catch (e) { atlas = false; }
  }

  // projection in the atlas's own coordinate space (circuit cells are the same space).
  // Orthographic fit like flyjump's BrainScene: fill BOTH axes so an elongated brain
  // doesn't leave the panel empty — half = max(ey/2, hypot(ex,ez)/2/aspect), x1.22 margin.
  function sceneProj(yaw, zoom, w, h) {
    const G = sceneGeom || brainGeom(window.__FLYJUMP);
    const aspect = w / h;
    const half = Math.max(G.ey / 2, Math.hypot(G.ex, G.ez) / 2 / Math.max(aspect, 1e-4)) * 1.22;
    const s = (h * 0.5 * zoom) / Math.max(half, 1e-9);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    return (x0, y0, z0) => {
      const X = (x0 - G.mx), Y = (y0 - G.my), Z = (z0 - G.mz);
      return { x: w / 2 + (X * cy + Z * sy) * s, y: h / 2 - Y * s, z: Z };
    };
  }

  function drawAtlasCloud(ctx, yaw, zoom, w, h) {
    if (!atlas) return;
    const L = atlas.lod, proj = sceneProj(yaw, zoom, w, h);
    const r = Math.max(3, Math.round(w / 180));
    const { lodP: P, lodCount, offsets } = L;
    brainPerf.atlasRects += lodCount; // bounded telemetry counter
    ctx.save();
    for (let g = 0; g < 3; g++) {
      const from = offsets[g], to = offsets[g + 1];
      if (to <= from) continue;
      ctx.beginPath();
      for (let i = from; i < to; i++) {
        const p = proj(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        ctx.rect(p.x, p.y, r, r);
      }
      ctx.globalAlpha = g === 0 ? 0.45 : 0.5;
      ctx.fillStyle = ATLAS_COL[g];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBrainEdges(ctx, J, proj) {
    ctx.lineWidth = 1; ctx.strokeStyle = "#254332"; ctx.globalAlpha = 0.55;
    const E = J.edges, P = J.positions;
    ctx.beginPath();
    for (let e = 0; e < E.length; e++) {
      const u = P[E[e][0]], v = P[E[e][1]];
      const a = proj(u[0], u[1], u[2]), b = proj(v[0], v[1], v[2]);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawBrainNodes(ctx, J, proj) {
    const act = J.decision.activity, roles = J.roles, P = J.positions;
    const order = new Array(P.length);
    for (let i = 0; i < P.length; i++) order[i] = i;
    order.sort((a, b) => proj(P[b][0], P[b][1], P[b][2]).z - proj(P[a][0], P[a][1], P[a][2]).z);
    for (let k = 0; k < order.length; k++) {
      const i = order[k], p = proj(P[i][0], P[i][1], P[i][2]), v = act[i], isOut = roles[i] === "output";
      ctx.globalAlpha = 0.4 + Math.min(0.6, Math.abs(v));
      ctx.fillStyle = sign(v);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + Math.min(3.5, Math.abs(v) * 0.5), 0, Math.PI * 2); ctx.fill();
      if (isOut) {
        ctx.globalAlpha = 1; ctx.strokeStyle = "#eeeeee"; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + Math.min(3.5, Math.abs(v) * 0.5) + 2.2, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function renderBrain(ctx, J, host) {
    brainPerf.renders++;
    const yaw = J.brainYaw || 0, zoom = J.brainZoom || 1;
    const { w, h, dpr } = canvas(ctx, host, 1);
    const graphChanged = !geom_ || cachedEdges !== J.edges;
    if (graphChanged) geom_ = brainGeom(J);
    const key = `${yaw.toFixed(3)}|${zoom.toFixed(3)}|${w}x${h}|d${dpr}|a${atlas ? atlas.count : 0}|g${J.positions.length}:${J.edges.length}`;
    if (!edgeLayer) edgeLayer = document.createElement("canvas");
    if (graphChanged || edgeLayer._key !== key) {
      const started = performance.now();
      brainPerf.rebuilds++;
      // Backing store in DEVICE pixels; drawing happens in CSS coords under a
      // dpr transform (one CSS px spans dpr device px) — same as the main canvas.
      const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (edgeLayer.width !== bw) edgeLayer.width = bw;
      if (edgeLayer.height !== bh) edgeLayer.height = bh;
      const lx = edgeLayer.getContext("2d");
      lx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lx.clearRect(0, 0, w, h);
      try {
        drawAtlasCloud(lx, yaw, zoom, w, h);                 // whole-brain shape
        drawBrainEdges(lx, J, sceneProj(yaw, zoom, w, h));   // circuit connections
      } catch (_) { /* keep the circuit view even if the atlas layer hiccups */ }
      edgeLayer._key = key; cachedEdges = J.edges;
      brainPerf.lastBuildMs = performance.now() - started;
      brainPerf.maxBuildMs = Math.max(brainPerf.maxBuildMs, brainPerf.lastBuildMs);
    }
    // Draw at CSS size (0,0,w,h): using the device size would double-scale it.
    ctx.drawImage(edgeLayer, 0, 0, w, h);
    drawBrainNodes(ctx, J, sceneProj(yaw, zoom, w, h));
    ctx.fillStyle = MUTED; ctx.font = `10px ${MONO.split("px")[1]}`;
    ctx.fillText(
      atlas && atlas.count ? `MaleCNS whole-brain atlas · ${atlas.lod.shown.toLocaleString()} somata (${atlas.lod.lodCount.toLocaleString()} LOD) · ${J.positions.length} live circuit cells`
        : atlas === false ? `${J.positions.length} live cells · atlas unavailable`
        : `${J.positions.length} live cells (atlas loading…)`,
      12, 14, Math.max(1, w - 24));
    ctx.fillText(`${J.positions.length} cells · ${J.edges.length} edges · drag rotate · scroll zoom`, 12, h - 8);
  }

  // --------------------------- Keyboard Output -------------------------------
  function renderKB(host, action) {
    const activeKey = action === 1 ? "left" : action === 2 ? "right" : action === 3 ? "up" : action === 4 ? "down" : null;
    const label = activeKey ? { left: "◀ LEFT", right: "▶ RIGHT", up: "▲ JUMP", down: "▼ DUCK" }[activeKey] : "● NO KEY · RUN";
    const key = (k, l, s) => `<span class="kbkey ${k === activeKey ? "on" : ""}">${s}<small>${l}</small></span>`;
    host.innerHTML = `<div class="kb"><div class="kbrow">${key("up", "JUMP", "▲")}</div>` +
      `<div class="kbrow">${key("left", "LEFT", "◀")}${key("down", "DUCK", "▼")}${key("right", "RIGHT", "▶")}</div>` +
      `<div class="kb-label">${label}</div></div>`;
  }

  // ------------------------------ input coalescing ----------------------------
  // Pointer/wheel bursts write PENDING deltas only; frame() commits them at a
  // bounded cadence (one commit + one redraw per ~33 ms slot) so a 200-event
  // drag can't cause 200 model writes and layer rebuilds. Drawing happens on
  // the SAME coalesced slot while dragging and at rest, so releasing the mouse
  // never triggers a higher-resolution rebuild hitch.
  const POINTER_SENS = 0.012;
  let pendDx = 0, lastX = null, dragging = false;
  let pendingWheel = 0, haveInput = false, pointerId = null;

  function noteInput() { haveInput = true; if (window.__BRAIN_PERF) window.__BRAIN_PERF.inputEvents++; }

  function coalescePointer(e, isMove) {
    if (!dragging || !window.__FLYJUMP) return;
    if (isMove && e.pointerId !== undefined && pointerId !== null && e.pointerId !== pointerId) return;
    if (e.clientX == null) return;
    if (lastX !== null) pendDx += e.clientX - lastX;
    lastX = e.clientX;
    noteInput();
  }

  function flushInput() {
    if (!haveInput) return false;
    const J = window.__FLYJUMP;
    if (J) {
      if (pendDx) J.brainYaw = (J.brainYaw || 0) + pendDx * POINTER_SENS;
      if (pendingWheel) J.brainZoom = Math.max(0.5, Math.min(3, (J.brainZoom || 1) + pendingWheel));
    }
    pendDx = pendingWheel = 0; haveInput = false;
    if (window.__BRAIN_PERF) window.__BRAIN_PERF.inputCommits++;
    return true;
  }

  // --------------------------------- loop ------------------------------------
  let prevSig = "", prevAction = -1, prevBrainView = "";
  let lastPanelFrame = -Infinity;
  function frame(now = performance.now()) {
    // No catch-up work after a hidden tab or long frame. Policy and brain share
    // this hard cap, so decisions/external view changes cannot bypass it.
    if (now - lastPanelFrame < 1000 / brainPerf.maxHz - 1e-6) {
      requestAnimationFrame(frame);
      return;
    }
    lastPanelFrame = now;
    // Commit coalesced input BEFORE reading the view: a drag frame renders the
    // freshest accumulated view, one commit + one layer rebuild per slot max.
    flushInput();
    const J = window.__FLYJUMP;
    if (J && J.decision && J.connected) {
      const d = J.decision;
      const sig = d.action + "|" + fmt(d.inputs[0]) + "|" +
        fmt(d.scores[0] + d.scores[1] + d.scores[2] + d.scores[3] + d.scores[4]);
      // Re-render the brain when the decision changes OR the 3D view changes
      // (rotate/zoom/resize) — otherwise rotation/zoom/resize leave a stale frame.
      const b = document.getElementById("brain-scene");
      const view = b ? `${(J.brainYaw || 0).toFixed(3)}|${(J.brainZoom || 1).toFixed(3)}|${b.clientWidth}x${b.clientHeight}|d${window.devicePixelRatio || 1}|atlas${atlas === null ? "loading" : atlas ? atlas.count : "failed"}` : "";
      // Track the view signature every frame so a mid-drag rotation re-renders
      // promptly and settles immediately once the view stops changing.
      if (sig !== prevSig || view !== prevBrainView || !geom_ || cachedEdges !== J.edges) {
        if (sig !== prevSig) {
          const p = document.getElementById("policy-network");
          if (p) renderPolicy(p.getContext("2d"), J, p);
          prevSig = sig;
        }
        if (b) renderBrain(b.getContext("2d"), J, b);
      }
      prevBrainView = view;
      if (d.action !== prevAction) {
        const kb = document.getElementById("keyboard-output");
        if (kb) renderKB(kb, d.action);
        prevAction = d.action;
      }
    }
    requestAnimationFrame(frame);
  }

  (function wire() {
    window.addEventListener("load", () => {
      const host = document.getElementById("brain-scene");
      function attach(el) {
        if (!el || el._coalesce) return;
        el._coalesce = true;
        el.style.touchAction = "none";
        el.addEventListener("pointerdown", (e) => {
          if (dragging || (e.button !== undefined && e.button !== 0)) return;
          dragging = true; lastX = e.clientX;
          pointerId = e.pointerId ?? null;
          noteInput();
          try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault && e.preventDefault();
        });
        el.addEventListener("pointermove", (e) => coalescePointer(e, true));
        function end(e, cancelled = false) {
          if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
          // Capture the final displacement BEFORE clearing `dragging` (the
          // coalesce guard requires it) so the pointer-up position is not lost.
          if (!cancelled && e.clientX != null && lastX !== null && window.__FLYJUMP) {
            pendDx += e.clientX - lastX;
            noteInput();
          }
          dragging = false; pointerId = null; lastX = null;
        }
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", (e) => end(e, true));
        el.addEventListener("lostpointercapture", (e) => end(e, true));
        el.addEventListener("wheel", (e) => {
          e.preventDefault();
          pendingWheel += -Math.sign(e.deltaY || 0) * 0.12;
          noteInput();
        }, { passive: false });
      }
      attach(host);
    });
  })();

  loadAtlas(); // whole-brain point cloud for the Brain Activity shape
  requestAnimationFrame(frame);
})();