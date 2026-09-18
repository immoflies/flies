// Build script: produce public/live.js = vendored game.js (UNMODIFIED) + trained
// agent, concatenated to share the game's top-level scope, exposing per-decision
// telemetry (inputs/hidden/scores/action/activity) + brain geometry on
// window.__FLYJUMP. Also emit the compact game-first workbench index.html.
//
// style.css and panels.js are authored assets; only audio.js is copied from vendor.
// The bundle order is: game.js + generated agent + theme.js overlay + runtime.js
// overlay (runtime owns the refresh-independent game clock and the agent scheduler
// by redeclaring `frame`/`connectWS`/`initCam`/`maybeSend`; later declarations win
// because they share one top-level scope in the single concatenated file).
//
// assembleLive() is exported so tests can validate the EXACT concatenation without
// requiring a rebuild of public/live.js (no side effects on import; the parent
// rebuilds the official artifact).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLanding } from './landing.mjs';
export { renderLanding };

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const wantBuild = process.argv.includes("--build");
const isMain = wantBuild || (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]));

const gameSrc = readFileSync(join(ROOT, "vendor/jurassic-runner/game.js"), "utf8");
const graph = JSON.parse(readFileSync(join(ROOT, "src/data/connectome.json"), "utf8"));
const champion = JSON.parse(readFileSync(join(ROOT, "public/checkpoints/champion.json"), "utf8"));

const N_IN = 16, N_HID = 12, N_OUT = 5;
const ACTIONS = ["NOOP", "LEFT", "RIGHT", "JUMP", "DUCK"];

// connectome weights (normalized signed), same derivation as lib/connectome.mjs
const totals = new Array(graph.nodes.length).fill(0);
for (const [pre, post, contacts] of graph.edges) totals[post] += contacts * Math.abs(graph.nodes[pre].sign);
const edges = graph.edges.map(([pre, post, contacts]) => [pre, post, totals[post] ? (contacts * graph.nodes[pre].sign) / totals[post] : 0]);

// graph.outputs / graph.edges already use node indices
const positions = graph.nodes.map((n) => n.position);
const roles = graph.nodes.map((n) => n.role);
const edgesIdx = graph.edges.map(([pre, post]) => [pre, post]);
const inputLabels = graph.outputs.map((idx) => graph.nodes[idx].type);

const VERSION = "jurassic-connectome-v1";

const agentCode = `
// ============ FlyJump trained agent (generated) ============
(function () {
  "use strict";
  const CIRCUIT = ${JSON.stringify(graph)};
  const W_EDGES = ${JSON.stringify(edges)};
  const CHAMP = ${JSON.stringify(Array.from(champion))};
  const N_IN = 16, N_HID = 12, N_OUT = 5;
  const ACTIONS = ${JSON.stringify(ACTIONS)};
  const PLAYER_T = 0.9, OB_LEAD = 1.1;
  const LE = 0.7, GA = 1.4, ITER = 3, OG = 4;
  const count = CIRCUIT.nodes.length;
  const activity = new Float64Array(count);
  const scratch = new Float64Array(count);
  const drive = new Float64Array(count);
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function circuitStep(inputs) {
    drive.fill(0);
    for (const [cell, channel] of CIRCUIT.inputs) drive[cell] = 2 * (inputs[channel] - 0.5);
    for (let t = 0; t < ITER; t++) {
      scratch.set(drive);
      for (let e = 0; e < W_EDGES.length; e++) {
        const [pre, post, w] = W_EDGES[e];
        scratch[post] += GA * w * activity[pre];
      }
      for (let i = 0; i < count; i++) activity[i] = (1 - LE) * activity[i] + LE * Math.tanh(scratch[i]);
    }
    return CIRCUIT.outputs.map((i) => activity[i] * OG);
  }
  function encode() {
    const p = player;
    const pick = (lane) => obstacles.reduce(
      (b, o) => o.resolved ? b : (Math.abs(o.lane - lane) < 0.6 && (!b || o.t > b.t) ? o : b), null);
    const P = (o) => (o ? 1 - clamp((PLAYER_T - o.t) / OB_LEAD, 0, 1) : 0);
    const dL = pick(-1), dC = pick(0), dR = pick(1);
    const mine = p.laneX <= -0.6 ? dL : p.laneX >= 0.6 ? dR : dC;
    return [
      P(dL), P(dC), P(dR),
      (p.laneX + 1) / 2,
      mine && mine.avoid === "jump" ? 1 : 0,
      mine && mine.avoid === "duck" ? 1 : 0,
      mine && mine.avoid === "move" ? 1 : 0,
      clamp(p.jumpY / 30, 0, 1),
    ];
  }
  function forward(x) {
    const c = CHAMP; let k = 0;
    const hidden = new Float64Array(N_HID);
    for (let i = 0; i < N_HID; i++) {
      let acc = 0;
      for (let j = 0; j < N_IN; j++) acc += c[k++] * x[j];
      acc += c[k++]; hidden[i] = Math.tanh(acc);
    }
    const scores = new Float64Array(N_OUT);
    for (let o = 0; o < N_OUT; o++) {
      let acc = 0;
      for (let j = 0; j < N_HID; j++) acc += c[k++] * hidden[j];
      acc += c[k++]; scores[o] = acc;
    }
    return { hidden, scores };
  }
  const last = {
    inputs: new Array(N_IN).fill(0), hidden: new Array(N_HID).fill(0),
    scores: new Array(N_OUT).fill(0), activity: new Array(count).fill(0), action: 0,
  };
  function decide() {
    const inputs = circuitStep(encode());
    const { hidden, scores } = forward(inputs);
    let bi = 0; for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
    for (let i = 0; i < N_IN; i++) last.inputs[i] = inputs[i];
    for (let i = 0; i < N_HID; i++) last.hidden[i] = hidden[i];
    for (let i = 0; i < N_OUT; i++) last.scores[i] = scores[i];
    for (let i = 0; i < count; i++) last.activity[i] = activity[i];
    last.action = bi;
    const key = ACTIONS[bi];
    KB.left = key === "LEFT"; KB.right = key === "RIGHT";
    KB.jump = key === "JUMP"; KB.duck = key === "DUCK";
    // Stamp the key-down timestamp on every non-NOOP decision so usingKb
    // decays ~200 ms after the agent STOPS holding a key (matching the
    // headless path where setKB clears keys each step). Without this the
    // stale lastKbDown keeps usingKb=true and readControls keeps using the
    // keyboard branch — the fly would hold one action forever in the live
    // bundle (caught by the runtime.test auto-play lockup regression).
    if (key !== "NOOP") lastKbDown = performance.now();
  }
  window.__FLYJUMP = {
    decision: last, weights: CHAMP,
    positions: ${JSON.stringify(positions)}, roles: ${JSON.stringify(roles)},
    edges: ${JSON.stringify(edgesIdx)}, actions: ${JSON.stringify(ACTIONS)},
    inputLabels: ${JSON.stringify(inputLabels)},
    N_IN, N_HID, N_OUT, version: ${JSON.stringify(VERSION)},
    brainYaw: 0.6, brainZoom: 1, connected: true,
    // agent decision hook — driven by runtime.js's fixed 60 Hz clock every 2 sim
    // ticks (~30 decisions/s), replacing the old setInterval. Fully testable.
    decide: decide,
    // zero the circuit activity buffer so each run starts clean (offline boots
    // are fresh, so this never changes offline policy counts).
    resetCircuit: function () { activity.fill(0); },
  };
  beginCalibration = function () { startRun(); };
  camReady = true; // RUN button bypasses camera init -> starts a run immediately
  setTimeout(() => { if (phase !== "playing" && phase !== "dead") startRun(); }, 1200);
})();
`;

// Pure assembly used both by the CLI (to write public/live.js) and by the tests
// (so they validate the exact concatenation without forcing a rebuild).
export function assembleLive() {
  const theme = existsSync(join(ROOT, "public/theme.js")) ? readFileSync(join(ROOT, "public/theme.js"), "utf8") : "";
  const runtime = existsSync(join(ROOT, "public/runtime.js")) ? readFileSync(join(ROOT, "public/runtime.js"), "utf8") : "";
  // steering-hold overlay ships in the bundle AND in the headless adapter, so
  // the trained policy's control semantics match the deployed page exactly.
  const hold = existsSync(join(ROOT, "overlay/hold-readcontrols.js")) ? readFileSync(join(ROOT, "overlay/hold-readcontrols.js"), "utf8") : "";
  return gameSrc + "\n;\n" + hold + "\n// ============ generated agent ============\n" + agentCode +
    "\n// ===== IMMORTAL FRUIT FLIES theme overlay =====\n" + theme +
    "\n// ===== runtime clock overlay =====\n" + runtime;
}

// Pure template rendering lets static-contract tests run without a rebuild.
export function renderHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>IMMORTAL FRUIT FLIES — live circuit monitor</title>
<link rel="icon" href="../favicon.png" type="image/png" />
<link rel="stylesheet" href="../style.css" />
</head>
<body>
<header class="topbar">
  <div class="brand"><h1>IMMORTAL FRUIT FLIES</h1></div>
  <button id="audio-toggle" class="audio-btn" type="button" aria-pressed="false">SOUND: OFF</button>
</header>

<div class="kicker">
  <span class="kicker-title">LIVE MONITOR / 01 · EXPERIMENTAL</span>
  <span>—</span>
  <span class="kicker-detail">a ${graph.nodes.length}-cell fly brain drives an endless runner · fixed 60 Hz clock</span>
</div>
<nav class="crumb" aria-label="Navigate"><a href="../">← Project home</a> · <a href="../monitor/">Change game</a></nav>

<ul class="legend" aria-label="Hazard legend">
  <li class="lg jump"><i></i><b>JUMP</b><span>broken road + pond — hop over</span></li>
  <li class="lg duck"><i></i><b>DUCK</b><span>flying bird — duck under</span></li>
  <li class="lg dodge"><i></i><b>DODGE</b><span>wooden wall — change lane</span></li>
</ul>

<main>
  <div class="workbench">
    <section class="panel game-panel">
      <div class="panel-head"><span class="num">01</span><h2>GAME</h2><small>IMMORTAL FRUIT FLIES · 60 Hz sim</small></div>
      <div class="stage">
        <canvas id="game" width="520" height="680"></canvas>
        <div id="overlay" class="game-overlay"><div class="card">
          <h3 id="overlay-title">READY?</h3>
          <p id="overlay-text">The trained agent takes the wheel in a moment. Arrows / space / down take over.</p>
          <button id="start">RUN</button>
        </div></div>
      </div>
      <div class="metrics">
        <div><span>SCORE</span><strong id="score">0</strong></div>
        <div><span>TIME</span><strong id="time">0.0</strong></div>
        <div><span>ACTION</span><strong id="action">RUN</strong></div>
      </div>
      <div class="panel-foot"><span>Agent auto-plays · keyboard overrides</span><span class="right" id="status">—</span></div>
      <!-- hidden controls the unmodified game requires at load -->
      <div style="display:none">
        <video id="cam" autoplay></video><canvas id="grab"></canvas><canvas id="pip"></canvas>
        <button id="mute">mute</button><button id="fs">fullscreen</button>
        <input id="speed-range" type="range" min="1" max="4" value="2" /><span id="speed-name">2×</span>
      </div>
    </section>

    <section class="panel network-panel">
      <div class="panel-head"><span class="num">02</span><h2>DECISION NETWORK</h2><small>16 → 12 → 5</small></div>
      <div class="scene"><canvas id="policy-network"></canvas><span class="hint">chosen action ▶</span></div>
      <div class="panel-foot"><span>Signed readout weights</span><span class="right">green + · orange −</span></div>
    </section>

    <section class="panel outputs-panel">
      <div class="panel-head"><span class="num">03</span><h2>KEYBOARD OUTPUT</h2><small>held key</small></div>
      <div id="keyboard-output"></div>
      <div class="panel-foot"><span>Largest score → key</span><span class="right">~30 decisions/s</span></div>
    </section>

    <section class="panel brain-panel">
      <div class="panel-head"><span class="num">04</span><h2>BRAIN ACTIVITY</h2><small>MaleCNS subset · 2D orthographic</small></div>
      <div class="scene"><canvas id="brain-scene"></canvas><span class="hint">drag rotate · scroll zoom</span></div>
      <div class="panel-foot"><span>Simulated activity</span><span class="right">measured connections</span></div>
    </section>
  </div>
</main>

<script src="../audio.js"></script>
<script src="../live.js"></script>
<script src="../panels.js"></script>
</body>
</html>`;
}

// "Open Monitor" picker: two separate games, one static menu. Emits NO scripts
// or iframes, so picking a game boots exactly that one page and nothing else.
export function renderPicker() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Open Monitor — IMMORTAL FRUIT FLIES · $FLIES</title>
<link rel="icon" href="../favicon.png" type="image/png">
<link rel="stylesheet" href="../landing.css">
</head>
<body class="landing">
<nav class="crumb landing-crumb" aria-label="Navigate"><a href="../">← Project home</a></nav>
<main class="picker shell" id="main">
  <header class="picker-head"><p class="eyebrow">Choose a game</p><h1>Open Monitor</h1>
  <p>The fly plays; you watch. Two autonomous agents use a brain from modeled MaleCNS circuit and engineered readouts. Each page runs only itself.</p></header>
  <div class="picker-grid">
    <a class="game-card" href="../runner/" aria-label="Open FLYINGFLIES live monitor">
      <span class="card-tag">GAME 01 · RUNNER · Experimental</span>
      <h2>FLYINGFLIES</h2>
      <p>The fly plays this endless three-lane runner: its trained readout chooses when to dodge, jump and duck. Follow circuit activity and the chosen keyboard output live.</p>
    </a>
    <a class="game-card" href="../saber/" aria-label="Open SABER4FLIES (experimental)">
      <span class="card-tag">GAME 02 · SABER4FLIES · Experimental</span>
      <h2>SABER4FLIES</h2>
      <p>The fly plays by moving its arm joints, not by emitting keyboard commands. Left saber glows cyan; right saber glows rose. Only moving blade contact with matching-color fruit scores.</p><p>Experimental motor control: repetitive motion remains under investigation.</p>
    </a>
  </div>
</main>
</body></html>`;
}

if (isMain) {
  copyFileSync(join(ROOT, "assets/favicon.png"), join(ROOT, "public/favicon.png"));
  copyFileSync(join(ROOT, "assets/og.png"), join(ROOT, "public/og.png"));
  const live = assembleLive();
  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeFileSync(join(ROOT, "public/live.js"), live);
  const html = renderHtml();
  mkdirSync(join(ROOT, "public/monitor"), { recursive: true });
  mkdirSync(join(ROOT, "public/runner"), { recursive: true });
  writeFileSync(join(ROOT, "public/monitor/index.html"), renderPicker());
  writeFileSync(join(ROOT, "public/runner/index.html"), html);
  cpSync(join(ROOT, "games/saber"), join(ROOT, "public/saber"), { recursive: true });
  // BRAINVIEW: vendored from the sibling brainview project (independent, uncommitted there)
  const bvSrc = join(ROOT, "..", "brainview", "public");
  if (existsSync(bvSrc)) {
    mkdirSync(join(ROOT, "public/brainview/data"), { recursive: true });
    for (const f of ["index.html", "app.js", "style.css", "data/flybody.bin", "data/circuit.json",
      "data/groups.bin", "data/ids.bin", "data/manifest.json", "data/meta.bin", "data/positions.bin", "data/strings.bin"])
      copyFileSync(join(bvSrc, f), join(ROOT, "public/brainview", f));
          console.log("brainview vendored -> public/brainview/");
  }
  writeFileSync(join(ROOT, "public/index.html"), renderLanding());
  // extensionless routing: keep tiny redirect stubs at the old .html paths so
  // any stale link/bookmark still resolves instead of 404-ing.
  const stub = t => '<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./' + t + '/"><title>IMMORTAL FRUIT FLIES</title><p><a href="./' + t + '/">Open the ' + t + ' page</a></p>';
  writeFileSync(join(ROOT, "public/monitor.html"), stub("monitor"));
  writeFileSync(join(ROOT, "public/runner.html"), stub("runner"));
  console.log('Homepage + monitor picker + runner + saber generated (extensionless: / /monitor/ /runner/ /saber/)');

  // only audio.js comes from vendor; style.css and panels.js are authored assets
  const vendored = join(ROOT, "vendor/jurassic-runner", "audio.js");
  if (existsSync(vendored)) copyFileSync(vendored, join(ROOT, "public/audio.js"));
  console.log("OK live.js=%dB index.html=%dB (compact game-first workbench)", live.length, html.length);
}
