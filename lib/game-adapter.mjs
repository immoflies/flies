// Headless lexical adapter for the vendored Jurassic Runner game.
// Loads vendor/jurassic-runner/game.js (UNMODIFIED) inside a stubbed platform:
// fake DOM + no-op 2D context, seeded Math.random, fixed performance clock,
// inert WebSocket/camera/audio. Returns live closures over the game's internal
// state so a training loop can READ state and WRITE the KB input object.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const GAME_SRC = readFileSync(join(__dir, "..", "vendor", "jurassic-runner", "game.js"), "utf8");
// steering-hold overlay — mirrors the LIVE bundle's readControls override so
// training/rollouts see the same control semantics as the deployed page.
const HOLD_SRC = readFileSync(join(__dir, "..", "overlay", "hold-readcontrols.js"), "utf8");

// ---------------------------------------------------------------- seeded RNG
export function makeRng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _idCounter = 0;
function makeFakeCtx() {
  // A fully permissive CanvasRenderingContext2D proxy: any property set is
  // stored, any method call returns a nested permissive object (so chains like
  // createLinearGradient().addColorStop() and lineTo/closePath() all work).
  const state = {};
  const handler = {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "canvas") return { width: 520, height: 680 };
      if (prop in state) return state[prop];
      // every method -> chains into a fresh permissive context
      return () => makeFakeCtx();
    },
    set(t, prop, val) {
      state[prop] = val;
      return true;
    },
  };
  return new Proxy({}, handler);
}

function makeFakeEl(width = 0, height = 0) {
  return {
    width,
    height,
    textContent: "",
    value: "2",
    style: {},
    className: "",
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    clientWidth: width,
    clientHeight: height,
    getContext: () => makeFakeCtx(),
  };
}

function buildGlobals({ random, now }) {
  const el = {};
  const def = (id, w, h) => {
    if (!el[id]) el[id] = makeFakeEl(w, h);
    return el[id];
  };
  // ids referenced by game.js
  def("game", 520, 680);
  def("cam");
  def("grab", 320, 240);
  def("pip", 240, 180);
  def("score");
  def("time");
  def("status");
  def("action");
  def("overlay");
  def("overlay-title");
  def("overlay-text");
  def("start");
  def("mute");
  def("fs");
  def("speed-range");
  def("speed-name");

  const fakeDocument = {
    getElementById: (id) => def(id),
    querySelector: () => def(".stage", 520, 680),
    addEventListener() {},
    fullscreenElement: null,
  };
  const fakeWindow = { addEventListener() {}, fullscreenElement: null };
  const fakeNavigator = {
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("headless: no cam")) },
  };
  const fakeLocation = { hostname: "localhost" };
  function FakeWebSocket() {
    this.binaryType = "arraybuffer";
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.send = () => {};
  }
  const MathRng = Object.create(Math);
  MathRng.random = random;
  return {
    document: fakeDocument,
    window: fakeWindow,
    navigator: fakeNavigator,
    location: fakeLocation,
    WebSocket: FakeWebSocket,
    requestAnimationFrame: () => 0,
    performance: { now },
    Math: MathRng,
  };
}

const API_SOURCE = `
return {
  update, startRun,
  // player & KB are mutated in place (safe as refs); obstacles/props are REBOUND
  // by startRun() and update()'s filter(), so they MUST be read via closures.
  player, KB,
  get obstacles(){return obstacles},
  get props(){return props},
  spawnObstacle, spawnProp,
  get spawnTimer(){return spawnTimer}, set spawnTimer(v){spawnTimer=v},
  get propTimer(){return propTimer}, set propTimer(v){propTimer=v},
  get score(){return score}, get speed(){return speed},
  get elapsed(){return elapsed}, get phase(){return phase},
  set phase(v){phase = v},
  get frameCount(){return frameCount},
  get worldScroll(){return worldScroll},
  get usingKb(){return usingKb},
  get action(){return action},
};
`;

// loadGame(seed, t0, hold): build a fresh isolated instance. Returns live API.
// `hold=false` skips the steering-hold overlay (used to replay/train the legacy
// recenter controller honestly when A/B comparing old vs new control semantics).
export function loadGame({ seed = 1, t0 = 0, hold = true } = {}) {
  let t = t0;
  const random = makeRng(seed);
  const now = () => t;
  const g = buildGlobals({ random, now });
  const fn = new Function(
    "document", "window", "navigator", "location", "WebSocket",
    "requestAnimationFrame", "performance", "Math",
    GAME_SRC + "\n;\n" + (hold ? HOLD_SRC : "") + "\n;\n" + API_SOURCE
  );
  const api = fn(g.document, g.window, g.navigator, g.location, g.WebSocket, g.requestAnimationFrame, g.performance, g.Math);
  // control the clock from outside so stepping is fully deterministic
  api._setClock = (ms) => { t = ms; };
  api._clock = () => t;
  return api;
}