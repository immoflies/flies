// runtime.test.mjs — refresh-independent fixed 60 Hz game clock + agent hook.
// Boots the EXACT assembled live bundle (game + agent + theme + runtime) via
// scripts/build-live.mjs#assembleLive() — no rebuild of public/live.js needed.
// Uses the pure, testable MakeClock factory the runtime exposes, so we can drive
// synthetic display rates (30/60/120/144 Hz) and a hidden-tab pause deterministically.
import vm from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRng } from "../lib/game-adapter.mjs";
import { assembleLive } from "../scripts/build-live.mjs";

export function bootWith(seed = 1, opts = {}) {
  const els = {};
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : () => ctx),
    set: (t, k, v) => (t[k] = v, true),
  });
  const el = (id) => els[id] ??= ({
    width: 520, height: 680, style: {}, value: "2",
    classList: { add() {}, remove() {} }, getContext: () => ctx,
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
    _listeners: {}, _attrs: {},
    getAttribute(k) { return this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
  });
  const math = Object.create(Math);
  math.random = makeRng(seed);
  const spies = { ws: 0, cam: 0, rAF: 0 };
  const sandbox = {
    document: { getElementById: el, querySelector: () => el("stage"), addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => { spies.cam++; throw Error("no camera"); } } },
    location: { hostname: "localhost" },
    WebSocket: function () { spies.ws++; },
    Math: math, performance: { now: () => 0 },
    setInterval: () => 0, setTimeout: () => 0,
    requestAnimationFrame: () => { spies.rAF++; },
    console,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  if (opts.jungle) sandbox.Jungle = opts.jungle;
  vm.createContext(sandbox);
  // Boot the full live bundle (must not throw; runtime neutralizes cam/ws startup).
  vm.runInContext(assembleLive() + "\nwindow.testApi={player,KB,startRun,update,render};", sandbox);
  return { sandbox, api: sandbox.testApi, spies, els };
}

export function boot(seed = 1) { return bootWith(seed, {}); }

test("runtime boots without camera/websocket attempts and exposes the agent hook", () => {
  const { sandbox, spies } = boot();
  assert.equal(typeof sandbox.__FLYJUMP.decide, "function", "decide hook exposed");
  assert.equal(typeof sandbox.__FLYJUMP.resetCircuit, "function", "resetCircuit exposed");
  assert.equal(typeof sandbox.__IFF_MAKE_CLOCK, "function", "MakeClock factory exposed");
  assert.equal(sandbox.__IFF_STEP, 1000 / 60, "STEP is the fixed 60 Hz timestep");
  // Top-level hoisted overrides must stop the vendored load-time startup calls.
  assert.equal(spies.ws, 0, "WebSocket never constructed (connectWS neutralized)");
  assert.equal(spies.cam, 0, "getUserMedia never requested (initCam neutralized)");
});

test("fixed 60 Hz sim yields the same tick count at 30/60/120/144 Hz displays", () => {
  const { sandbox } = boot();
  const MakeClock = sandbox.__IFF_MAKE_CLOCK;
  const counts = [30, 60, 120, 144].map((rate) => {
    const c = MakeClock();
    const dt = 1000 / rate;              // display frame interval
    c.reset(0);
    let t = 0, updates = 0;
    for (let f = 0; f < rate; f++) {     // exactly one wall-clock second
      t += dt;
      updates += c.advance(t).updates;
    }
    return updates;
  });
  for (const n of counts) {
    assert.ok(n >= 59 && n <= 61, `~60 sim updates in 1s across displays (got ${n})`);
  }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1,
    `all display rates produce the same number of sim ticks (${counts.join(",")})`);
});

test("large gap (hidden tab) does not burst simulation ticks, then resumes", () => {
  const { sandbox } = boot();
  const c = sandbox.__IFF_MAKE_CLOCK();
  const dt = 1000 / 60;
  c.reset(0);
  let t = 0;
  for (let i = 0; i < 60; i++) { t += dt; c.advance(t); }   // 1s of normal play
  const before = c.tick;
  assert.ok(before >= 59 && before <= 61, "advanced ~60 ticks before pause");

  const gap = 5000;                                          // tab hidden ~5s
  const res = c.advance(t + gap);
  assert.equal(res.updates, 0, "no catch-up burst on resume from hidden tab");
  assert.equal(c.tick, before, "sim clock did not advance across the pause");

  const resume = c.advance(t + gap + dt);
  assert.ok(resume.updates >= 1, "simulation resumes normally after the pause");
});

test("render interpolation alpha is exposed and bounded 0..1", () => {
  const { sandbox } = boot();
  const c = sandbox.__IFF_MAKE_CLOCK();
  const dt = 1000 / 144;
  c.reset(0);
  let t = 0, alpha = 0;
  for (let i = 0; i < 144; i++) {
    t += dt;
    const r = c.advance(t);
    alpha = r.alpha;
    assert.ok(alpha >= 0 && alpha <= 1, `alpha ${alpha} in [0,1]`);
  }
  assert.ok(alpha > 0 && alpha < 1, "sub-tick alpha lets draw code interpolate between sim ticks");
});

test("top-level `frame` is the runtime replacement and drives sim + agent end-to-end", () => {
  const { sandbox, api, spies } = boot();
  assert.equal(sandbox.frame, sandbox.__IFF_FRAME, "vendored frame is replaced by runtime frame");
  api.startRun();
  sandbox.frame(0);               // prime clock (updates: 0)
  sandbox.frame(1000 / 60);       // 1 sim tick -> update() ran, agent decided
  sandbox.frame(2 * 1000 / 60);   // more ticks

  assert.ok(typeof api.player.laneX === "number", "player state advanced by update()");
  assert.equal(spies.rAF, 4, "vendor tail + each display frame re-arm requestAnimationFrame (runtime frame)");
  const act = sandbox.__FLYJUMP.decision.action;
  assert.ok(Number.isInteger(act) && act >= 0 && act <= 4, `agent produced a valid action (${act})`);
  assert.ok(sandbox.__FLYJUMP.decision.scores[act] !== undefined, "decision carries scores");
});

test("held keyboard keys are not clobbered by the agent (manual beats auto)", () => {
  const { sandbox, api } = boot();
  api.startRun();
  sandbox.frame(0);                       // prime clock
  // hold ArrowRight as a HUMAN (real keydown sets the human-input signal)
  api.KB.right = true;
  api.lastKbDown = 0;
  sandbox.__IFF_NOTE_HUMAN_INPUT();
  // with the human signal active, frame must NOT let decide clear the key
  for (let i = 0; i < 24; i++) sandbox.frame((i + 1) * 1000 / 60);
  assert.equal(api.KB.right, true, "held RIGHT survives many frames (decide skipped while human holds key)");
  assert.ok(api.player.laneX > -0.1, "player is steered by the held key, not overridden");
});

test("agent auto-play does NOT wedge after its own non-idle decisions", () => {
  const { sandbox, api } = boot();
  api.startRun();
  sandbox.frame(0);
  // No human keypress: the agent must decide every 2 ticks (~30/s). The old
  // usingKb gate wedged auto-play after the first non-NOOP decision (decide
  // stopped firing). Wrap decide to count CALLS — the lockup signal — instead
  // of relying on action diversity (the new hold physics legitimately makes a
  // chosen lane stable, so `changed` may be low without any lockup).
  let fires = 0;
  const orig = sandbox.__FLYJUMP.decide;
  sandbox.__FLYJUMP.decide = function () { fires++; return orig.apply(this, arguments); };
  let prev = null, changed = 0;
  for (let i = 0; i < 180; i++) {          // ~3 s of sim
    sandbox.frame((i + 1) * 1000 / 60);
    const a = sandbox.__FLYJUMP.decision.action;
    if (a !== prev) { changed++; prev = a; }
  }
  assert.ok(sandbox.__FLYJUMP.decision.scores.some((s) => s !== 0), "agent is producing decisions");
  assert.ok(fires >= 80, `decide keeps firing under auto-play (${fires}/~90), no lockup`);
  assert.ok(changed >= 1, `policy takes at least one other action (${changed} changes in 3s)`);
});

test("audio starts muted on load and the header SOUND button flips it on/off", () => {
  const returns = []; // Jungle.toggle() return values: true = now muted
  let starts = 0;
  const jungle = { start: () => { starts++; }, toggle: () => { const m = returns.length % 2 === 0; returns.push(m); return m; } };
  const { els } = bootWith(1, { jungle });
  const btn = els["audio-toggle"];
  assert.equal(returns.length, 1, "Jungle.toggle() called exactly once at boot to mute");
  assert.equal(returns[0], true, "boot leaves the engine muted");
  assert.equal(btn.textContent, "SOUND: OFF", "button reads muted state on load");
  assert.equal(btn.getAttribute("aria-pressed"), "false", "aria-pressed=false while muted");

  // First click: unmute (2nd call returns muted=false) and start the engine.
  const fire = () => (btn._listeners.click || []).forEach((fn) => fn());
  fire();
  assert.equal(returns.length, 2, "button flips the engine");
  assert.equal(returns[1], false, "click unmutes");
  assert.equal(starts, 1, "unmuting also starts the audio engine (sound is audible)");
  assert.equal(btn.textContent, "SOUND: ON", "button reads unmuted state");
  assert.equal(btn.getAttribute("aria-pressed"), "true", "aria-pressed=true while unmuted");

  fire(); // third call -> muted again
  assert.equal(btn.textContent, "SOUND: OFF", "second click mutes again");
});
