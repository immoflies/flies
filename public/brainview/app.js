/* BRAINVIEW — whole MaleCNS fruit-fly brain in WebGL2.
 * 140,024 traced somata · orbit / zoom / pan · GPU point picking ·
 * every neuron identified by real body ID + annotation. 80-cell circuit overlay.
 * No dependencies. Data: ../data/*.bin (scripts/build-data.py) + ../data/circuit.json.
 * Fly body: Janelia/DeepMind "flybody" model (GPL-3.0), baked via scripts/build-flymesh.py.
 * Coordinates match fruitflyweb's brain atlas: (x,-y,-z), centered, uniform scale.
 */
"use strict";

const BIN = "data/";
const GROUPS = [
  { key: "optic",      label: "optic",      color: [0.51, 0.71, 0.78] }, // #81b5c8
  { key: "central",    label: "central",    color: [0.81, 0.79, 0.75] }, // #cfcac0
  { key: "descending", label: "descending", color: [0.87, 0.71, 0.45] }, // #dfb672
  { key: "vnc",        label: "VNC",        color: [0.69, 0.61, 0.76] }, // #af9bc3
  { key: "other",      label: "other",      color: [0.42, 0.47, 0.47] }, // #6c7777
];
const EXC = [1.0, 0.34, 0.25], INH = [0.62, 0.15, 0.11]; // circuit edges: hot red / dark red

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (n) => n.toLocaleString("en-US");

// ---------------------------------------------------------------- state ----
const state = {
  yaw: -0.6, pitch: 0.30,
  dist: 6, minDist: 0.05, maxDist: 10,
  target: [0, 0, 0],
  fov: 45,
  selected: -1,
  layers: [true, true, true, true, true],
  circuitOn: true,
  flyOn: true,
  dragging: false, panning: false,
};
let gl, canvas, dpr = 1, aspect = 1;

// ----------------------------------------------------------------- data ----
let positions, groups, ids, metaOff, stringsBin, count = 0;
let normPos = null;         // Float32Array, normalized to [-1,1]
let colBuf = null;          // Float32Array rgba per point
let bounds = null;
let circuit = null;         // {nodes, edges}
let circuitNodes = null, circuitEdges = null; // GPU-ready arrays
const decoder = new TextDecoder();

async function fetchBuf(p) {
  const r = await fetch(p);
  if (!r.ok) throw new Error("HTTP " + r.status + " — " + p);
  return r.arrayBuffer();
}

async function loadAll() {
  const m = await (await fetch(BIN + "manifest.json")).json();
  count = m.count;
  const [pb, gb, ib, mb, sb, cb] = await Promise.all([
    fetchBuf(BIN + m.files.positions), fetchBuf(BIN + m.files.groups),
    fetchBuf(BIN + m.files.ids), fetchBuf(BIN + m.files.metaOffsets),
    fetchBuf(BIN + m.files.strings), fetchBuf("data/circuit.json"),
  ]);
  positions = new Float32Array(pb);
  groups = new Uint8Array(gb);
  ids = new Int32Array(ib);
  metaOff = new Uint32Array(mb);
  stringsBin = new Uint8Array(sb);
  circuit = JSON.parse(decoder.decode(cb));
  // real fruit-fly body mesh (optional — page still works without it)
  try { flyBodyData = new Float32Array(await fetchBuf("data/flybody.bin")); } catch { flyBodyData = null; }
  if (positions.length !== count * 3 || groups.length !== count) throw new Error("buffer size mismatch");

  // normalize: (x,-y,-z) then center + uniform scale to [-1,1]
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = -positions[i * 3 + 1], z = -positions[i * 3 + 2];
    if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
    if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
    if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
  }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  const s = 2 / ext;
  bounds = { c, s };
  normPos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    normPos[i * 3] = (positions[i * 3] - c[0]) * s;
    normPos[i * 3 + 1] = (-positions[i * 3 + 1] - c[1]) * s;
    normPos[i * 3 + 2] = (-positions[i * 3 + 2] - c[2]) * s;
  }
  colBuf = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const g = GROUPS[groups[i]] || GROUPS[4];
    colBuf[i * 4] = g.color[0]; colBuf[i * 4 + 1] = g.color[1];
    colBuf[i * 4 + 2] = g.color[2]; colBuf[i * 4 + 3] = 0.9;
  }
}

function readMeta(i) {
  const off = metaOff[i];
  const len = stringsBin[off] | (stringsBin[off + 1] << 8) | (stringsBin[off + 2] << 16) | (stringsBin[off + 3] << 24);
  const p = decoder.decode(stringsBin.subarray(off + 4, off + 4 + len)).split("|");
  return { type: p[0], instance: p[1], superclass: p[2], subclass: p[3], side: p[4], status: p[5] };
}
function posOf(i) { // original 8nm voxel coords
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

// --------------------------------------------------------------- search ----
let searchIdx = null;
function buildSearch() {
  searchIdx = new Map();
  for (let i = 0; i < count; i++) {
    const m = readMeta(i);
    for (const key of new Set([m.type.toLowerCase(), m.instance.toLowerCase()])) {
      if (!key) continue;
      let a = searchIdx.get(key);
      if (!a) searchIdx.set(key, (a = []));
      a.push(i);
    }
  }
}
function doSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  if (/^\d{3,}$/.test(q)) {
    const id = parseInt(q, 10), hits = [];
    for (let i = 0; i < count && hits.length < 30; i++) if (ids[i] === id) hits.push(i);
    return hits;
  }
  if (!searchIdx) buildSearch();
  const seen = new Set(), out = [];
  const push = (arr) => { for (const i of arr) if (!seen.has(i)) { seen.add(i); out.push(i); if (out.length >= 60) return true; } return false; };
  for (const [key, arr] of searchIdx) if (key.startsWith(q) && push(arr)) return out;
  if (!out.length) for (const [key, arr] of searchIdx) if (key.includes(q) && push(arr)) return out;
  return out;
}

// ------------------------------------------------------------- shaders ----
const VS_PTS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
uniform mat4 uMVP;
uniform float uSize;
out vec3 vCol;
out float vA;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  vCol = aCol.rgb; vA = aCol.a;
  gl_PointSize = clamp(uSize, 1.0, 40.0);
}`;
const FS_PTS = `#version 300 es
precision mediump float;
in vec3 vCol; in float vA;
uniform float uAlpha;
out vec4 frag;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.30, d);       // soft round sprite
  float hot = smoothstep(0.28, 0.0, d);        // bright centre
  vec3 c = vCol * (0.72 + 0.55 * hot);
  frag = vec4(c, vA * uAlpha * core);
}`;
const VS_PICK = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
uniform float uSize;
flat out int vId;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  vId = gl_VertexID;
  gl_PointSize = clamp(uSize, 1.0, 40.0);
}`;
const FS_PICK = `#version 300 es
precision highp float;
flat in int vId;
out vec4 frag;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  if (length(p) > 0.5) discard;
  int id = vId + 1;
  frag = vec4(float(id & 255) / 255.0, float((id >> 8) & 255) / 255.0, float((id >> 16) & 255) / 255.0, 1.0);
}`;
const VS_FLAT = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
uniform float uSize;
void main(){ gl_Position = uMVP * vec4(aPos, 1.0); gl_PointSize = clamp(uSize, 1.0, 40.0); }`;
const FS_FLAT = `#version 300 es
precision mediump float;
uniform vec4 uCol;
out vec4 frag;
void main(){ frag = uCol; }`;
const VS_BODY = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uMVP;
out vec3 vN;
out vec3 vW;
void main(){
  gl_Position = uMVP * vec4(aPos, 1.0);
  vN = aNor; vW = aPos;
}`;
const FS_BODY = `#version 300 es
precision mediump float;
in vec3 vN;
in vec3 vW;
uniform vec3 uEye;
uniform vec3 uCol;
uniform float uAlpha;
out vec4 frag;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  float ndv = abs(dot(N, V));
  float fres = pow(1.0 - ndv, 2.6);          // glowing rim, glassy face
  float a = uAlpha * (0.10 + 1.1 * fres);
  vec3 c = uCol * (0.38 + 0.95 * fres);
  frag = vec4(c, a);
}`;
const VS_CIRC = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
uniform mat4 uMVP;
out vec4 vCol;
void main(){ gl_Position = uMVP * vec4(aPos, 1.0); vCol = aCol; }`;
const FS_CIRC = `#version 300 es
precision mediump float;
in vec4 vCol;
uniform float uAlpha;
out vec4 frag;
void main(){ frag = vec4(vCol.rgb, vCol.a * uAlpha); }`;

function makeProg(vs, fs) {
  const sh = (t, s) => {
    const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ----------------------------------------------------------------- GL ------
let progPts, progPick, progFlat, progCirc, progBody, uni = {};
let vaoPts, vaoCircLines, vaoCircNodes, vaoSel, vaoFlyMesh;
let flyIdxBuf = null, flyMeshVertCount = 0;
const eyePos = new Float32Array(3); // camera position for fresnel shading
let visIdxBuf = null, visCount = 0, selBuf = null;
function rebuildVisible() {
  const idx = new Uint32Array(count);
  let n = 0;
  for (let i = 0; i < count; i++) if (state.layers[groups[i]]) idx[n++] = i;
  visCount = n;
  gl.bindVertexArray(vaoPts);            // ELEMENT_ARRAY_BUFFER is VAO state
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, visIdxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.subarray(0, n), gl.DYNAMIC_DRAW);
  gl.bindVertexArray(null);
}
let pickFBO = null, pickW = 0, pickH = 0;

function initGL() {
  canvas = $("gl");
  gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) throw new Error("WebGL2 unavailable");
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  progPts = makeProg(VS_PTS, FS_PTS);
  progPick = makeProg(VS_PICK, FS_PICK);
  progFlat = makeProg(VS_FLAT, FS_FLAT);
  progCirc = makeProg(VS_CIRC, FS_CIRC);
  progBody = makeProg(VS_BODY, FS_BODY);
  for (const [n, p] of [["pts", progPts], ["pick", progPick], ["flat", progFlat], ["circ", progCirc]]) {
    uni[n] = {
      mvp: gl.getUniformLocation(p, "uMVP"),
      size: gl.getUniformLocation(p, "uSize"),
      col: gl.getUniformLocation(p, "uCol"),
      alpha: gl.getUniformLocation(p, "uAlpha"),
    };
  }
  uni.body = {
    mvp: gl.getUniformLocation(progBody, "uMVP"),
    eye: gl.getUniformLocation(progBody, "uEye"),
    col: gl.getUniformLocation(progBody, "uCol"),
    alpha: gl.getUniformLocation(progBody, "uAlpha"),
  };

  vaoPts = gl.createVertexArray();
  gl.bindVertexArray(vaoPts);
  const bPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
  gl.bufferData(gl.ARRAY_BUFFER, normPos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const bCol = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
  gl.bufferData(gl.ARRAY_BUFFER, colBuf, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  // element index buffer for layer filtering (rebuilt on toggle)
  visIdxBuf = gl.createBuffer();
  visCount = count;
  rebuildVisible();

  buildCircuitBuffers();
  buildFlyMeshBuffers();

  // selection marker: a single point we re-position via bufferSubData
  vaoSel = gl.createVertexArray();
  gl.bindVertexArray(vaoSel);
  const bSel = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bSel);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
  selBuf = bSel;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0); // CSS radial vignette shows through
}

function buildCircuitBuffers() {
  if (!circuit) return;
  const N = circuit.nodes, E = circuit.edges;
  const toWorld = (p) => [
    (p[0] - bounds.c[0]) * bounds.s,
    (-p[1] - bounds.c[1]) * bounds.s,
    (-p[2] - bounds.c[2]) * bounds.s,
  ];
  const segs = new Float32Array(E.length * 6);
  const segCol = new Float32Array(E.length * 8);
  for (let e = 0; e < E.length; e++) {
    const a = toWorld(N[E[e][0]].position), b = toWorld(N[E[e][1]].position);
    segs.set(a, e * 6); segs.set(b, e * 6 + 3);
    const c = N[E[e][0]].sign < 0 ? INH : EXC;
    for (let v = 0; v < 2; v++) { segCol.set(c, e * 8 + v * 4); segCol[e * 8 + v * 4 + 3] = 0.85; }
  }
  const nodes = new Float32Array(N.length * 3);
  const nodeCol = new Float32Array(N.length * 4);
  const ROLE = { input: [1.0, 0.55, 0.45], interneuron: [0.72, 0.22, 0.16], output: [1.0, 0.38, 0.28] }; // reds
  N.forEach((n, i) => {
    nodes.set(toWorld(n.position), i * 3);
    const c = ROLE[n.role] || ROLE.interneuron;
    nodeCol.set(c, i * 4); nodeCol[i * 4 + 3] = 1;
  });

  vaoCircLines = gl.createVertexArray();
  gl.bindVertexArray(vaoCircLines);
  const bl = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bl);
  gl.bufferData(gl.ARRAY_BUFFER, segs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const blc = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, blc);
  gl.bufferData(gl.ARRAY_BUFFER, segCol, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

  vaoCircNodes = gl.createVertexArray();
  gl.bindVertexArray(vaoCircNodes);
  const bn = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bn);
  gl.bufferData(gl.ARRAY_BUFFER, nodes, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const bnc = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bnc);
  gl.bufferData(gl.ARRAY_BUFFER, nodeCol, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// ------------------------------------------------------- fly body layer ----
// Real fruit fly body: Janelia/DeepMind "flybody" MuJoCo model (CT-derived
// anatomy), posed in its default qpos, aligned head→brain / thorax→VNC and
// baked to world space by scripts/build-flymesh.py → public/data/flybody.bin
const FLY_COL = [0.62, 0.68, 0.58]; // pale grey-green hologram
let flyBodyData = null;

// fresnel body mesh: real fruit fly model (Janelia/DeepMind "flybody", MuJoCo
// CT-derived mesh), posed + aligned to the MaleCNS atlas and baked into
// world-space positions+normals by scripts/build-flymesh.py → data/flybody.bin
function buildFlyMeshBuffers() {
  if (!flyBodyData) return;
  const arr = flyBodyData; // interleaved: pos(3) + normal(3) per vertex, world space
  vaoFlyMesh = gl.createVertexArray();
  gl.bindVertexArray(vaoFlyMesh);
  const bp = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bp);
  gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  flyMeshVertCount = arr.length / 6;
}

// ------------------------------------------------------------- matrices ----
const mvp = new Float32Array(16);
function updateMVP() {
  const { yaw, pitch, dist } = state;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ex = state.target[0] + dist * cp * sy;
  const ey = state.target[1] + dist * sp;
  const ez = state.target[2] + dist * cp * cy;
  eyePos[0] = ex; eyePos[1] = ey; eyePos[2] = ez;
  let fx = state.target[0] - ex, fy = state.target[1] - ey, fz = state.target[2] - ez;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // right = normalize(forward × up), up = [0,1,0]
  let rx = fz, ry = 0, rz = -fx;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  // view matrix (column-major)
  const V = [
    rx, ux, -fx, 0,
    ry, uy, -fy, 0,
    rz, uz, -fz, 0,
    -(rx * ex + ry * ey + rz * ez), -(ux * ex + uy * ey + uz * ez), (fx * ex + fy * ey + fz * ez), 1,
  ];
  const t = Math.tan((state.fov * Math.PI) / 360), n = 0.01, f = 40;
  const P = [
    1 / (aspect * t), 0, 0, 0,
    0, 1 / t, 0, 0,
    0, 0, -(f + n) / (f - n), -1,
    0, 0, -2 * f * n / (f - n), 0,
  ];
  // M = P · V (both column-major): out[c*4+r] = Σ_k P[k*4+r] * V[c*4+k]
  for (let c = 0; c < 4; c++) {
    const b0 = V[c * 4], b1 = V[c * 4 + 1], b2 = V[c * 4 + 2], b3 = V[c * 4 + 3];
    for (let r = 0; r < 4; r++)
      mvp[c * 4 + r] = P[r] * b0 + P[4 + r] * b1 + P[8 + r] * b2 + P[12 + r] * b3;
  }
}

// ------------------------------------------------------------ rendering ----
// point size: grows as you zoom in; capped. base 1.7px at full-brain distance
function pointSize() {
  return clamp(1.7 + (3.4 / state.dist) * 1.1, 1.7, 9.0);
}
function drawPoints(prog, u, sizeMul, alpha) {
  gl.bindVertexArray(vaoPts);
  gl.uniformMatrix4fv(u.mvp, false, mvp);
  gl.uniform1f(u.size, pointSize() * (sizeMul || 1));
  gl.uniform1f(u.alpha, alpha === undefined ? 1 : alpha);
  gl.drawElements(gl.POINTS, visCount, gl.UNSIGNED_INT, 0);
}

function render() {
  resize();
  updateMVP();
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // somata: core pass (depth-written) + additive glow halo on top
  gl.useProgram(progPts);
  drawPoints(progPts, uni.pts);
  gl.depthMask(false);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);           // additive bloom
  drawPoints(progPts, uni.pts, 2.8, 0.16);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(true);

  // circuit overlay: red polarity edges + additive glow so it burns through the cloud
  if (state.circuitOn && circuit) {
    gl.depthMask(false);
    gl.useProgram(progCirc);
    gl.uniformMatrix4fv(uni.circ.mvp, false, mvp);
    gl.bindVertexArray(vaoCircLines);
    gl.uniform1f(uni.circ.alpha, 1.0);
    gl.drawArrays(gl.LINES, 0, circuit.edges.length * 2);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);               // glow pass
    gl.uniform1f(uni.circ.alpha, 0.55);
    gl.drawArrays(gl.LINES, 0, circuit.edges.length * 2);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.useProgram(progPts);
    gl.bindVertexArray(vaoCircNodes);
    gl.uniformMatrix4fv(uni.pts.mvp, false, mvp);
    gl.uniform1f(uni.pts.size, 10.0);
    gl.uniform1f(uni.pts.alpha, 1.0);
    gl.drawArrays(gl.POINTS, 0, circuit.nodes.length);
  }

  // fly body: fresnel-shaded real fly model (wireframe cage dropped — model has real anatomy)
  if (state.flyOn && vaoFlyMesh) {
    gl.depthMask(false);
    gl.useProgram(progBody);
    gl.uniformMatrix4fv(uni.body.mvp, false, mvp);
    gl.uniform3fv(uni.body.eye, eyePos);
    gl.uniform3fv(uni.body.col, FLY_COL);
    gl.uniform1f(uni.body.alpha, 0.9);
    gl.bindVertexArray(vaoFlyMesh);
    gl.drawArrays(gl.TRIANGLES, 0, flyMeshVertCount);
    gl.depthMask(true);
  }

  // selection marker
  if (state.selected >= 0 && state.layers[groups[state.selected]]) {
    gl.useProgram(progFlat);
    gl.bindVertexArray(vaoSel);
    gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, normPos.subarray(state.selected * 3, state.selected * 3 + 3));
    gl.uniformMatrix4fv(uni.flat.mvp, false, mvp);
    gl.uniform1f(uni.flat.size, 11.0);
    gl.uniform4f(uni.flat.col, 0.75, 0.88, 0.69, 1); // #bfe0b0
    gl.drawArrays(gl.POINTS, 0, 1);
  }
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); // track browser zoom / monitor moves
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  aspect = w / h;
  gl.viewport(0, 0, bw, bh);
}

// -------------------------------------------------------------- picking ----
function ensurePickFBO() {
  const w = canvas.width, h = canvas.height;
  if (pickFBO && pickW === w && pickH === h) return;
  if (pickFBO) { gl.deleteFramebuffer(pickFBO.fbo); gl.deleteTexture(pickFBO.tex); gl.deleteRenderbuffer(pickFBO.dep); }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const dep = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  pickFBO = { fbo, tex, dep }; pickW = w; pickH = h;
}

function pickAt(clientX, clientY) {
  ensurePickFBO();
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((clientX - rect.left) * dpr);
  const y = Math.round((rect.height - (clientY - rect.top)) * dpr);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO.fbo);
  gl.viewport(0, 0, pickW, pickH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(progPick);
  gl.bindVertexArray(vaoPts);
  gl.uniformMatrix4fv(uni.pick.mvp, false, mvp);
  gl.uniform1f(uni.pick.size, pointSize());
  gl.drawElements(gl.POINTS, visCount, gl.UNSIGNED_INT, 0);
  const px = new Uint8Array(4);
  gl.readPixels(clamp(x, 0, pickW - 1), clamp(y, 0, pickH - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.BLEND);
  const id = (px[0] | (px[1] << 8) | (px[2] << 16)) - 1;
  if (id >= 0 && id < count && state.layers[groups[id]]) return id;
  return -1;
}

// -------------------------------------------------------------- controls ----
function initControls() {
  let lastX = 0, lastY = 0, moved = 0;
  canvas.addEventListener("pointerdown", (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers */ }
    touch();
    state.dragging = e.button === 0;
    state.panning = e.button === 2 || e.buttons === 2;
    lastX = e.clientX; lastY = e.clientY; moved = 0;
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!state.dragging && !state.panning) return;
    touch();
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (state.panning) {
      const k = state.dist * 0.0016;
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      state.target[0] -= (dx * cy) * k;
      state.target[2] -= (-dx * sy) * k;
      state.target[1] += dy * k;
    } else {
      state.yaw -= dx * 0.0055;
      state.pitch = clamp(state.pitch + dy * 0.0055, -1.45, 1.45);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    const wasDrag = moved > 6;
    state.dragging = state.panning = false;
    if (!wasDrag && e.button === 0) {
      const id = pickAt(e.clientX, e.clientY);
      selectNeuron(id);
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    touch();
    const k = Math.exp(e.deltaY * 0.0012);
    state.dist = clamp(state.dist * k, state.minDist, state.maxDist);
  }, { passive: false });

  $("pickClose").addEventListener("click", () => {
    $("pickPanel").classList.add("hidden");
    state.selected = -1;
  });
  $("dockMin").addEventListener("click", () => {
    const dock = $("dock");
    const min = dock.classList.toggle("min");
    $("dockMin").textContent = min ? "+" : "–";
    $("dockMin").setAttribute("aria-expanded", String(!min));
  });
  document.querySelectorAll("[data-action]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.dataset.action === "reset") resetCamera();
    }));
}
function resetCamera() {
  state.yaw = -0.6; state.pitch = 0.30; state.dist = 6; state.target = [0, 0, 0];
}

// ------------------------------------------------------------ selection ----
function selectNeuron(i) {
  state.selected = i;
  const panel = $("pickPanel");
  if (i < 0) { panel.classList.add("hidden"); return; }
  const m = readMeta(i), g = GROUPS[groups[i]];
  $("pickTitle").textContent = m.instance || m.type || ("Neuron " + ids[i]);
  $("pickId").textContent = fmt(ids[i]);
  $("pickType").textContent = m.type || "—";
  $("pickSuper").textContent = m.superclass || "—";
  $("pickSub").textContent = m.subclass || "—";
  $("pickSide").textContent = m.side || "—";
  $("pickGroup").textContent = g ? g.label : String(groups[i]);
  $("pickPos").textContent = posOf(i).map((v) => Math.round(v)).join(", ");
  $("pickStatus").textContent = m.status || "—";
  panel.classList.remove("hidden");
  // focus the orbit target on it (keeps current distance)
  state.target = [normPos[i * 3], normPos[i * 3 + 1], normPos[i * 3 + 2]];
  state.dist = clamp(state.dist, state.minDist, 2.2);
}

// ------------------------------------------------------------------- UI ----
function initUI() {
  // counts
  const cnt = [0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) cnt[groups[i]]++;
  $("n-all").textContent = fmt(count);
  GROUPS.forEach((g, gi) => ($("n-" + gi).textContent = fmt(cnt[gi] || 0)));
  $("n-circuit").textContent = circuit ? circuit.nodes.length + "·" + circuit.edges.length : "—";
  $("statTotal").textContent = fmt(count);
  $("statShown").textContent = fmt(count);
  $("statPts").textContent = fmt(count);

  const boxes = ["lg-0", "lg-1", "lg-2", "lg-3", "lg-4"].map($);
  boxes.forEach((b, gi) =>
    b.addEventListener("change", () => {
      state.layers[gi] = b.checked;
      $("lg-all").checked = state.layers.every(Boolean);
      rebuildVisible();
      $("statShown").textContent = fmt(visCount);
    }));
  $("lg-all").addEventListener("change", (e) => {
    const on = e.target.checked;
    state.layers = state.layers.map(() => on);
    boxes.forEach((b) => (b.checked = on));
    state.circuitOn = on;                                   // "all" drives every layer…
    const cb = $("lg-circuit"); if (cb) cb.checked = on;
    state.flyOn = on;
    const fb = $("lg-fly"); if (fb) fb.checked = on;
    if (state.flyOn && state.dist < 6) state.dist = 6;      // fly body needs the wider frame
    rebuildVisible();
    $("statShown").textContent = fmt(visCount);
  });
  $("lg-circuit").addEventListener("change", (e) => (state.circuitOn = e.target.checked));
  $("lg-fly").addEventListener("change", (e) => {
    state.flyOn = e.target.checked;
    if (state.flyOn && state.dist < 6) state.dist = 6;   // the body is bigger than the brain — frame it
    touch();
  });

  // search
  const input = $("search"), list = $("results");
  input.addEventListener("input", () => {
    const hits = doSearch(input.value);
    list.innerHTML = "";
    for (const i of hits) {
      const m = readMeta(i);
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.innerHTML = `<b>${(m.instance || m.type || ids[i]).replace(/</g, "&lt;")}</b><span>${ids[i]}</span>`;
      const go = () => { selectNeuron(i); list.innerHTML = ""; input.value = m.instance || m.type || ""; };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      list.appendChild(li);
    }
  });
  $("prog").firstElementChild.style.width = "100%";
  $("status").textContent = fmt(count) + " neurons";
  $("statusDot").classList.add("ok");
}

// ------------------------------------------------------------------ main ----
let lastAct = 0;
function touch() { lastAct = performance.now(); }
let rafPending = false;
function frame(now) {
  rafPending = false;
  if (!gl) return;
  // gentle drift when idle — the brain slowly turns itself
  if (!state.dragging && !state.panning && now - lastAct > 4000) state.yaw += 0.0011;
  render();
  if (!rafPending) { rafPending = true; requestAnimationFrame(frame); }
}

async function main() {
  try {
    await loadAll();
    initGL();
    initControls();
    initUI();
    // small screens: start with the dock minimized so the brain leads
    if (window.innerWidth < 700) {
      $("dock").classList.add("min");
      $("dockMin").textContent = "+";
      $("dockMin").setAttribute("aria-expanded", "false");
    }
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    $("status").textContent = "failed: " + err.message;
    $("statusDot").classList.add("err");
  }
}
main();