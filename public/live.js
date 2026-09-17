const game = document.getElementById("game");
const ctx = game.getContext("2d");
const cam = document.getElementById("cam");
const grab = document.getElementById("grab");
const gctx = grab.getContext("2d");
const pip = document.getElementById("pip");
const pctx = pip.getContext("2d");

const elScore = document.getElementById("score");
const elTime = document.getElementById("time");
const elStatus = document.getElementById("status");
const elAction = document.getElementById("action");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startBtn = document.getElementById("start");
const muteBtn = document.getElementById("mute");
const fsBtn = document.getElementById("fs");
const speedRange = document.getElementById("speed-range");
const speedName = document.getElementById("speed-name");
const fsTarget = document.querySelector(".stage");
const SPEED_NAMES = ["", "Slow", "Normal", "Fast", "Insane"];

const W = game.width;
const H = game.height;
const HORIZON = 176;
const PLAYER_T = 0.9;
const LANES = [-1, 0, 1];
const JUMP_THRESH = 0.05;
const DUCK_THRESH = 0.07;
const SPEED_MUL = [0, 0.2, 0.45, 0.85, 1.5];
let speedLevel = 2;

let phase = "ready";
let steer = 0.5;
let bodyY = 0.5;
let bodyYSmooth = 0.5;
let baselineY = 0.5;
let bodyPresent = false;
let camReady = false;
let wsReady = false;
let lastFace = null;
let faceImg = null;
let hasFace = false;

let ws = null;
let awaiting = false;
let lastSend = 0;

let obstacles = [];
let props = [];
let spawnTimer = 0;
let propTimer = 0;
let speed = 0;
let score = 0;
let startTime = 0;
let elapsed = 0;
let worldScroll = 0;
let frameCount = 0;
let restartAt = 0;
let trexT = 1.45;
let calStart = 0;
let calSamples = [];
let action = "RUN";

const player = { laneX: 0, jumpY: 0, vy: 0, grounded: true, ducking: false };
const KB = { left: false, right: false, jump: false, duck: false };
let lastKbDown = -9999;
let usingKb = false;
const LANE_GAIN = 7.5;
const LANE_DEAD = 0.03;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function projY(t) { return HORIZON + (H - HORIZON) * t; }
function projHalf(t) { return 16 + 252 * Math.pow(t, 1.62); }
function laneToX(lane, t) { return W / 2 + lane * projHalf(t) * 0.52; }
function edgeX(side, t) { return W / 2 + side * projHalf(t) * 1.16; }

function connectWS() {
  try {
    ws = new WebSocket("ws://" + location.hostname + ":8765");
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { wsReady = true; };
    ws.onmessage = (e) => {
      awaiting = false;
      try {
        const m = JSON.parse(e.data);
        bodyPresent = !!m.present;
        if (m.present) {
          if (typeof m.x === "number") steer = m.x;
          if (typeof m.y === "number") bodyY = m.y;
          if (m.face) lastFace = m.face;
        }
      } catch (_) {}
    };
    ws.onclose = () => { wsReady = false; awaiting = false; setTimeout(connectWS, 1500); };
    ws.onerror = () => {};
  } catch (_) {
    setTimeout(connectWS, 1500);
  }
}

async function initCam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    cam.srcObject = stream;
    await cam.play();
    camReady = true;
    return true;
  } catch (_) {
    camReady = false;
    return false;
  }
}

function maybeSend(ts) {
  if (!ws || ws.readyState !== 1 || awaiting || !camReady) return;
  if (ts - lastSend < 60) return;
  lastSend = ts;
  awaiting = true;
  gctx.drawImage(cam, 0, 0, grab.width, grab.height);
  grab.toBlob((blob) => {
    if (!blob || !ws || ws.readyState !== 1) { awaiting = false; return; }
    blob.arrayBuffer().then((b) => { if (ws.readyState === 1) ws.send(b); else awaiting = false; });
  }, "image/jpeg", 0.5);
}

function captureFace() {
  if (!lastFace || !camReady) return;
  const vw = cam.videoWidth, vh = cam.videoHeight;
  if (!vw || !vh) return;
  const sx = clamp(lastFace.x, 0, 1) * vw;
  const sy = clamp(lastFace.y, 0, 1) * vh;
  const sw = clamp(lastFace.w, 0.05, 1) * vw;
  const sh = clamp(lastFace.h, 0.05, 1) * vh;
  const fc = document.createElement("canvas");
  fc.width = 180; fc.height = 180;
  const fx = fc.getContext("2d");
  fx.drawImage(cam, sx, sy, sw, sh, 0, 0, 180, 180);
  faceImg = fc;
  hasFace = true;
}

function beginCalibration() {
  phase = "calibrating";
  calStart = performance.now();
  calSamples = [];
  startBtn.style.display = "none";
  overlay.classList.add("hidden");
}

function startRun() {
  obstacles = [];
  props = [];
  spawnTimer = 46;
  propTimer = 10;
  speed = 0.0058;
  score = 0;
  player.laneX = 0; player.jumpY = 0; player.vy = 0; player.grounded = true; player.ducking = false;
  startTime = performance.now();
  elapsed = 0;
  trexT = 1.45;
  phase = "playing";
  overlay.classList.add("hidden");
}

function crash(ts) {
  phase = "dead";
  restartAt = ts + 3000;
  trexT = 1.3;
  action = "CAUGHT";
  overlayTitle.textContent = "CAUGHT!";
  overlayText.textContent = "Survived " + elapsed.toFixed(1) + "s and scored " + score + ". The T-Rex got you — restarting in 3s.";
  startBtn.style.display = "none";
  overlay.classList.remove("hidden");
  if (window.Jungle) Jungle.roar();
}

const OBSTACLES = [
  { kind: "rock", avoid: "jump", w: 0.18 },
  { kind: "raptor", avoid: "jump", w: 0.22 },
  { kind: "ptero", avoid: "duck", w: 0.28 },
  { kind: "tree", avoid: "move", w: 0.14 },
  { kind: "stego", avoid: "move", w: 0.18 },
];

function spawnObstacle() {
  let r = Math.random(), pick = OBSTACLES[0];
  for (const o of OBSTACLES) { if (r < o.w) { pick = o; break; } r -= o.w; }
  const lane = LANES[(Math.random() * 3) | 0];
  obstacles.push({ kind: pick.kind, avoid: pick.avoid, lane, t: 0, resolved: false, cleared: false, seed: Math.random() * 6.28 });
}

function spawnProp() {
  props.push({ t: 0, side: Math.random() < 0.5 ? -1 : 1, off: 0.18 + Math.random() * 0.6, kind: Math.random() < 0.55 ? "fern" : "bush", seed: Math.random() * 6.28 });
}

function readControls(ts) {
  const kbHeld = KB.left || KB.right || KB.jump || KB.duck;
  usingKb = kbHeld || ts - lastKbDown < 200;
  let targetLane = 0, wantJump = false, wantDuck = false;
  if (usingKb) {
    targetLane = (KB.left ? -1 : 0) + (KB.right ? 1 : 0);
    wantJump = KB.jump;
    wantDuck = KB.duck;
  } else if (bodyPresent) {
    let d = steer - 0.5;
    d = Math.sign(d) * Math.max(0, Math.abs(d) - LANE_DEAD);
    targetLane = clamp(d * LANE_GAIN, -1, 1);
    bodyYSmooth = lerp(bodyYSmooth, bodyY, 0.4);
    wantJump = baselineY - bodyYSmooth > JUMP_THRESH;
    wantDuck = bodyYSmooth - baselineY > DUCK_THRESH;
  }
  return { targetLane, wantJump, wantDuck };
}

function updateCalibration(ts) {
  if (bodyPresent) calSamples.push(bodyY);
  if ((ts - calStart) / 1000 >= 3) {
    baselineY = calSamples.length > 4 ? calSamples.reduce((a, b) => a + b, 0) / calSamples.length : 0.5;
    bodyYSmooth = baselineY;
    captureFace();
    startRun();
  }
}

function update(ts) {
  frameCount++;
  if (phase === "calibrating") { updateCalibration(ts); return; }
  if (phase === "dead") {
    trexT = lerp(trexT, 0.99, 0.05);
    worldScroll += 2;
    if (ts >= restartAt) startRun();
    return;
  }
  if (phase !== "playing") return;

  elapsed = (ts - startTime) / 1000;
  speed = Math.min(0.017, 0.0058 + elapsed * 0.00009) * SPEED_MUL[speedLevel];
  worldScroll += speed * 620;

  const c = readControls(ts);
  player.laneX = lerp(player.laneX, c.targetLane, 0.22);
  if (c.wantJump && player.grounded) { player.vy = 13.0; player.grounded = false; if (window.Jungle) Jungle.jump(); }
  if (!player.grounded) {
    player.jumpY += player.vy;
    player.vy -= 0.46;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.grounded = true; }
  }
  const wasDucking = player.ducking;
  player.ducking = c.wantDuck && player.grounded;
  if (player.ducking && !wasDucking && window.Jungle) Jungle.duck();

  action = !player.grounded ? "JUMP" : player.ducking ? "DUCK" : player.laneX < -0.4 ? "LEFT" : player.laneX > 0.4 ? "RIGHT" : "RUN";

  spawnTimer -= 1;
  if (spawnTimer <= 0) { spawnObstacle(); spawnTimer = Math.max(24, 64 - elapsed * 1.1); }
  propTimer -= 1;
  if (propTimer <= 0) { spawnProp(); propTimer = 12 + Math.random() * 16; }

  for (const o of obstacles) {
    o.t += speed;
    if (!o.resolved && o.t >= PLAYER_T) {
      o.resolved = true;
      const sameCol = Math.abs(player.laneX - o.lane) < 0.6;
      let safe = !sameCol;
      if (!safe) {
        if (o.avoid === "jump") safe = player.jumpY > 14;
        else if (o.avoid === "duck") safe = player.ducking;
        else safe = false;
      }
      if (safe) { score += 10; o.cleared = true; }
      else { crash(ts); break; }
    }
  }
  obstacles = obstacles.filter((o) => o.t < 1.12);
  for (const p of props) p.t += speed;
  props = props.filter((p) => p.t < 1.14);
  if (frameCount % 6 === 0) score += 1;
}

function drawVolcano(cx) {
  ctx.fillStyle = "#241a22";
  ctx.beginPath();
  ctx.moveTo(cx - 120, HORIZON);
  ctx.lineTo(cx - 28, HORIZON - 96);
  ctx.lineTo(cx - 10, HORIZON - 80);
  ctx.lineTo(cx + 8, HORIZON - 98);
  ctx.lineTo(cx + 120, HORIZON);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(244,120,60,0.8)";
  ctx.beginPath();
  ctx.moveTo(cx - 14, HORIZON - 92);
  ctx.lineTo(cx + 10, HORIZON - 94);
  ctx.lineTo(cx + 4, HORIZON - 72);
  ctx.lineTo(cx - 8, HORIZON - 72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(120,110,120,0.35)";
  for (let i = 0; i < 3; i++) {
    const yy = HORIZON - 110 - i * 26 + Math.sin(worldScroll * 0.002 + i) * 6;
    ctx.beginPath();
    ctx.arc(cx - 2 + i * 9, yy, 14 + i * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTreeline(par) {
  ctx.fillStyle = "#10241a";
  let x = -40 + (par % 64);
  while (x < W + 40) {
    const h = 40 + ((x * 37) % 30);
    ctx.beginPath();
    ctx.moveTo(x - 30, HORIZON + 4);
    ctx.lineTo(x, HORIZON - h);
    ctx.lineTo(x + 30, HORIZON + 4);
    ctx.closePath();
    ctx.fill();
    x += 48;
  }
}

function drawSauropod(cx, cy, sc, dir) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);
  ctx.fillStyle = "#13251a";
  ctx.beginPath();
  ctx.ellipse(0, -18 * sc, 34 * sc, 18 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-26 * sc, -22 * sc);
  ctx.quadraticCurveTo(-72 * sc, -14 * sc, -98 * sc, 0);
  ctx.quadraticCurveTo(-66 * sc, -4 * sc, -22 * sc, -10 * sc);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18 * sc, -28 * sc);
  ctx.quadraticCurveTo(46 * sc, -62 * sc, 50 * sc, -86 * sc);
  ctx.lineTo(60 * sc, -84 * sc);
  ctx.quadraticCurveTo(56 * sc, -56 * sc, 32 * sc, -22 * sc);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(58 * sc, -88 * sc, 9 * sc, 6 * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-18 * sc, -6 * sc, 8 * sc, 16 * sc);
  ctx.fillRect(-2 * sc, -6 * sc, 8 * sc, 16 * sc);
  ctx.fillRect(16 * sc, -6 * sc, 8 * sc, 16 * sc);
  ctx.restore();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 70);
  sky.addColorStop(0, "#16243a");
  sky.addColorStop(0.55, "#41524a");
  sky.addColorStop(1, "#d8a85c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON + 70);

  ctx.fillStyle = "rgba(255, 224, 168, 0.55)";
  ctx.beginPath();
  ctx.arc(W * 0.32, HORIZON - 46, 40, 0, Math.PI * 2);
  ctx.fill();

  const par = -player.laneX * 22;
  drawVolcano(W * 0.72 + par * 0.5);
  const d1 = (frameCount * 0.35) % (W + 260) - 130;
  drawSauropod(d1 + par * 0.4, HORIZON - 4, 0.5, 1);
  const d2 = W + 130 - ((frameCount * 0.22) % (W + 260));
  drawSauropod(d2 + par * 0.4, HORIZON - 1, 0.7, -1);
  drawTreeline(par);
}

function drawPath() {
  ctx.fillStyle = "#163021";
  ctx.fillRect(0, HORIZON, W, H - HORIZON);

  ctx.beginPath();
  ctx.moveTo(edgeX(-1, 0), projY(0));
  for (let t = 0; t <= 1.0001; t += 0.05) ctx.lineTo(edgeX(-1, t), projY(t));
  for (let t = 1; t >= 0; t -= 0.05) ctx.lineTo(edgeX(1, t), projY(t));
  ctx.closePath();
  const g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, "#5c4730");
  g.addColorStop(1, "#977244");
  ctx.fillStyle = g;
  ctx.fill();

  const period = 0.11;
  const off = ((worldScroll * 0.0009) % period + period) % period;
  ctx.strokeStyle = "rgba(60,42,22,0.45)";
  for (let t = off; t <= 1; t += period) {
    ctx.beginPath();
    ctx.lineWidth = 1 + t * 6;
    ctx.moveTo(edgeX(-1, t), projY(t));
    ctx.lineTo(edgeX(1, t), projY(t));
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,240,200,0.16)";
  for (const d of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.lineWidth = 2;
    let on = true;
    for (let t = 0; t <= 1; t += 0.04) {
      const px = laneToX(d * 2, t), py = projY(t);
      if (on) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      on = !on;
    }
    ctx.stroke();
  }
}

function drawProp(p) {
  const x = edgeX(p.side, p.t) + p.side * p.off * projHalf(p.t);
  const y = projY(p.t);
  const s = projHalf(p.t) / projHalf(1) * 1.1;
  if (s < 0.02) return;
  if (p.kind === "bush") {
    ctx.fillStyle = "#1f5a30";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(x + i * 16 * s, y - 12 * s, 18 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#2a7340";
    ctx.beginPath();
    ctx.arc(x, y - 26 * s, 16 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#2c8a45";
    ctx.lineWidth = 3 * s;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + i * 14 * s, y - 44 * s, x + i * 26 * s, y - 70 * s);
      ctx.stroke();
    }
  }
}

function drawRock(x, y, s, seed) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * s, 30 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7d7a78";
  ctx.beginPath();
  ctx.moveTo(x - 30 * s, y);
  ctx.lineTo(x - 18 * s, y - 34 * s);
  ctx.lineTo(x + 6 * s, y - 40 * s);
  ctx.lineTo(x + 28 * s, y - 22 * s);
  ctx.lineTo(x + 30 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#9a9794";
  ctx.beginPath();
  ctx.moveTo(x - 18 * s, y - 34 * s);
  ctx.lineTo(x + 6 * s, y - 40 * s);
  ctx.lineTo(x - 2 * s, y - 18 * s);
  ctx.lineTo(x - 22 * s, y - 14 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTree(x, y, s) {
  ctx.fillStyle = "#5a3c1f";
  ctx.fillRect(x - 9 * s, y - 78 * s, 18 * s, 78 * s);
  ctx.fillStyle = "#1f6b35";
  for (const o of [[-22, -70], [22, -74], [0, -96]]) {
    ctx.beginPath();
    ctx.arc(x + o[0] * s, y + o[1] * s, 30 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#2c8a45";
  ctx.beginPath();
  ctx.arc(x, y - 86 * s, 22 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawPtero(x, y, s, seed) {
  const flap = Math.sin(worldScroll * 0.02 + seed) * 0.5;
  y -= 86 * s;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(x, projY(PLAYER_T) + 2, 26 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a2c3a";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - 30 * s, y - (20 + flap * 30) * s, x - 52 * s, y + 4 * s);
  ctx.quadraticCurveTo(x - 26 * s, y + 8 * s, x, y + 4 * s);
  ctx.quadraticCurveTo(x + 26 * s, y + 8 * s, x + 52 * s, y + 4 * s);
  ctx.quadraticCurveTo(x + 30 * s, y - (20 + flap * 30) * s, x, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4a3a4a";
  ctx.beginPath();
  ctx.ellipse(x, y + 6 * s, 8 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 6 * s, y + 2 * s);
  ctx.lineTo(x + 22 * s, y - 2 * s);
  ctx.lineTo(x + 7 * s, y + 8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRaptor(x, y, s, seed) {
  const lsw = Math.sin(worldScroll * 0.06 + seed) * 7 * s;
  const top = y - 60 * s;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 24 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5f8336";
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, y - 34 * s);
  ctx.quadraticCurveTo(x - 42 * s, y - 50 * s, x - 56 * s, y - 66 * s);
  ctx.quadraticCurveTo(x - 30 * s, y - 40 * s, x + 2 * s, y - 28 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#4d6b2b"; ctx.lineWidth = 6 * s; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - 5 * s, y - 30 * s); ctx.lineTo(x - 5 * s - lsw, y - 12 * s); ctx.lineTo(x - 9 * s - lsw, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 5 * s, y - 30 * s); ctx.lineTo(x + 5 * s + lsw, y - 12 * s); ctx.lineTo(x + 9 * s + lsw, y); ctx.stroke();
  ctx.fillStyle = "#6b8f3a";
  ctx.beginPath(); ctx.ellipse(x, y - 40 * s, 16 * s, 22 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#cdbb7a";
  ctx.beginPath(); ctx.ellipse(x, y - 34 * s, 9 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#5f8336"; ctx.lineWidth = 3.5 * s;
  ctx.beginPath(); ctx.moveTo(x - 8 * s, y - 46 * s); ctx.lineTo(x - 16 * s, y - 38 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 8 * s, y - 46 * s); ctx.lineTo(x + 16 * s, y - 38 * s); ctx.stroke();
  ctx.fillStyle = "#6b8f3a";
  ctx.beginPath(); ctx.ellipse(x, top + 8 * s, 12 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, top + 10 * s);
  ctx.lineTo(x + 19 * s, top + 14 * s);
  ctx.lineTo(x - 2 * s, top + 18 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + (3 + i * 5) * s, top + 14 * s); ctx.lineTo(x + (5 + i * 5) * s, top + 17 * s); ctx.lineTo(x + (7 + i * 5) * s, top + 14 * s); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = "#f4d03c"; ctx.beginPath(); ctx.arc(x + 2 * s, top + 6 * s, 3.2 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.arc(x + 3 * s, top + 6 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStego(x, y, s) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 38 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#7a6a45";
  ctx.beginPath();
  ctx.moveTo(x - 40 * s, y - 20 * s);
  ctx.quadraticCurveTo(x - 20 * s, y - 48 * s, x + 6 * s, y - 46 * s);
  ctx.quadraticCurveTo(x + 40 * s, y - 44 * s, x + 46 * s, y - 18 * s);
  ctx.quadraticCurveTo(x + 20 * s, y - 8 * s, x - 20 * s, y - 10 * s);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + 50 * s, y - 16 * s, 10 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6a5a3a";
  ctx.fillRect(x - 26 * s, y - 14 * s, 9 * s, 16 * s);
  ctx.fillRect(x - 6 * s, y - 14 * s, 9 * s, 16 * s);
  ctx.fillRect(x + 14 * s, y - 14 * s, 9 * s, 16 * s);
  ctx.fillRect(x + 30 * s, y - 14 * s, 9 * s, 16 * s);
  ctx.fillStyle = "#3f8a5a";
  for (const p of [[-26, -38], [-12, -48], [2, -52], [16, -48], [30, -40]]) {
    ctx.beginPath();
    ctx.moveTo(x + (p[0] - 8) * s, y + (p[1] + 14) * s);
    ctx.lineTo(x + p[0] * s, y + p[1] * s);
    ctx.lineTo(x + (p[0] + 8) * s, y + (p[1] + 14) * s);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#cfcfcf";
  for (const dx of [-50, -56]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y - 22 * s); ctx.lineTo(x + (dx - 4) * s, y - 33 * s); ctx.lineTo(x + (dx + 3) * s, y - 25 * s); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

function drawRex(cx, groundY, sc, open, runP) {
  const col = "#5a8a3a", colD = "#3f6b2a", colDk = "#2c4f22", belly = "#cdbb84";
  const ns = Math.sin(runP), fs = Math.sin(runP + Math.PI);
  ctx.save();
  ctx.translate(cx, groundY);
  ctx.scale(sc, sc);

  ctx.fillStyle = colD;
  ctx.beginPath();
  ctx.moveTo(-20, -150);
  ctx.quadraticCurveTo(-150, -158, -215, -92);
  ctx.quadraticCurveTo(-150, -118, -18, -120);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = colDk;
  ctx.beginPath(); ctx.ellipse(15, -118, 33, 47, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 17; ctx.strokeStyle = colDk; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(14, -92); ctx.lineTo(-4 + fs * 10, -42); ctx.lineTo(24 + fs * 16, -8); ctx.stroke();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-22, -150);
  ctx.quadraticCurveTo(30, -218, 120, -196);
  ctx.quadraticCurveTo(158, -186, 156, -150);
  ctx.quadraticCurveTo(146, -110, 95, -96);
  ctx.quadraticCurveTo(35, -84, -6, -112);
  ctx.quadraticCurveTo(-32, -126, -22, -150);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.moveTo(100, -100); ctx.quadraticCurveTo(40, -86, 2, -110);
  ctx.quadraticCurveTo(60, -104, 118, -118); ctx.closePath(); ctx.fill();

  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(62, -112, 42, 58, -0.12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = colD; ctx.lineWidth = 22; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(64, -76); ctx.lineTo(48 + ns * 10, -30); ctx.lineTo(92 + ns * 18, -4); ctx.stroke();
  ctx.fillStyle = colDk;
  ctx.beginPath(); ctx.moveTo(74 + ns * 18, -6); ctx.lineTo(118 + ns * 18, -6); ctx.lineTo(114 + ns * 18, 7); ctx.lineTo(78 + ns * 18, 7); ctx.closePath(); ctx.fill();

  ctx.strokeStyle = colD; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(126, -150); ctx.lineTo(140, -128); ctx.lineTo(136, -110); ctx.stroke();
  ctx.strokeStyle = "#e8e0c0"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(136, -110); ctx.lineTo(132, -101); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(136, -110); ctx.lineTo(142, -103); ctx.stroke();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(120, -190); ctx.quadraticCurveTo(150, -210, 188, -208);
  ctx.lineTo(188, -168); ctx.quadraticCurveTo(150, -162, 128, -162); ctx.closePath(); ctx.fill();

  const hx = 196, hy = -212;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(hx - 18, hy + 44);
  ctx.quadraticCurveTo(hx - 26, hy - 6, hx + 26, hy - 8);
  ctx.quadraticCurveTo(hx + 86, hy - 12, hx + 128, hy + 16);
  ctx.lineTo(hx + 134, hy + 32);
  ctx.quadraticCurveTo(hx + 96, hy + 40, hx + 40, hy + 44);
  ctx.lineTo(hx - 18, hy + 44);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#3a1820";
  ctx.beginPath();
  ctx.moveTo(hx - 12, hy + 46);
  ctx.lineTo(hx + 130, hy + 33);
  ctx.lineTo(hx + 122, hy + 36 + open);
  ctx.lineTo(hx - 12, hy + 50);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#9c4a50";
  ctx.beginPath(); ctx.ellipse(hx + 66, hy + 44 + open * 0.62, 30, 9, -0.08, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = colD;
  ctx.beginPath();
  ctx.moveTo(hx - 16, hy + 48);
  ctx.lineTo(hx + 122, hy + 36 + open);
  ctx.lineTo(hx + 114, hy + 56 + open);
  ctx.quadraticCurveTo(hx + 30, hy + 70 + open, hx - 14, hy + 60 + open);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#f4efe0";
  for (let i = 0; i < 8; i++) {
    const t = 0.18 + i * 0.1, tx = hx - 12 + t * 142, ty = hy + 45 - 12 * t;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 4, ty + 11); ctx.lineTo(tx + 8, ty); ctx.closePath(); ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    const t = 0.28 + i * 0.1, tx = hx - 16 + t * 138, ty = hy + 48 + (open - 12) * t;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 4, ty - 10); ctx.lineTo(tx + 8, ty); ctx.closePath(); ctx.fill();
  }

  ctx.fillStyle = "#f4d03c"; ctx.beginPath(); ctx.arc(hx + 60, hy + 10, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a1a1a"; ctx.beginPath(); ctx.ellipse(hx + 62, hy + 10, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colDk; ctx.beginPath(); ctx.moveTo(hx + 44, hy - 2); ctx.lineTo(hx + 78, hy + 2); ctx.lineTo(hx + 72, hy + 10); ctx.lineTo(hx + 48, hy + 8); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx + 120, hy + 22, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawChaser() {
  const f = frameCount;
  const surge = Math.max(0, Math.sin(f * 0.025));
  const lunge = surge * surge;
  const x = W / 2 - player.laneX * 30 + Math.sin(f * 0.04) * 26;
  const groundY = H + 98 - lunge * 150 + Math.sin(f * 0.3) * 4;
  const open = 26 + lunge * 40;
  drawRex(x, groundY, 0.66, open, f * 0.3);
}

function drawObstacle(o) {
  const x = laneToX(o.lane, o.t);
  const y = projY(o.t);
  const s = projHalf(o.t) / projHalf(PLAYER_T);
  if (s < 0.02) return;
  if (o.kind === "rock") drawRock(x, y, s, o.seed);
  else if (o.kind === "tree") drawTree(x, y, s);
  else if (o.kind === "raptor") drawRaptor(x, y, s, o.seed);
  else if (o.kind === "stego") drawStego(x, y, s);
  else drawPtero(x, y, s, o.seed);
}

function drawFace(x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (hasFace && faceImg) {
    ctx.drawImage(faceImg, x - r, y - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#d8a878";
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(x - r, y - r, r * 2, r * 0.5);
    ctx.fillStyle = "#26190f";
    ctx.beginPath(); ctx.arc(x - r * 0.36, y, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.36, y, r * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "#1c2a1c";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRunner() {
  const t = PLAYER_T;
  const x = laneToX(player.laneX, t);
  const ground = projY(t);
  const s = projHalf(t) / projHalf(1) * 1.25;
  const lift = player.jumpY * 0.95;
  const duck = player.ducking;
  const run = player.grounded && !duck;
  const airborne = !player.grounded;
  const hipW = 5 * s, shW = 11 * s;
  const stride = frameCount * 0.4;

  let bodyH = 40 * s, legH = 26 * s, headR = 15 * s;
  if (duck) { bodyH *= 0.5; legH *= 0.6; }

  const shScale = clamp(1 - lift / 130, 0.45, 1);
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(x, ground + 3, 24 * s * shScale, 7 * s * shScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const feet = ground - lift;
  const hip = feet - legH;
  const shoulder = hip - bodyH;
  const head = shoulder - headR * 0.6;

  ctx.lineCap = "round";
  ctx.strokeStyle = "#caa06a";
  ctx.lineWidth = 7 * s;
  for (const side of [-1, 1]) {
    const sw = run ? Math.sin(stride + (side > 0 ? Math.PI : 0)) : 0;
    const hipX = x + side * hipW;
    let footX, footY;
    if (airborne) { footX = hipX + side * 4 * s; footY = feet - 15 * s; }
    else if (duck) { footX = hipX + side * 9 * s; footY = feet; }
    else { footX = hipX + sw * 7 * s; footY = feet - Math.max(0, sw) * 10 * s; }
    const kneeX = (hipX + footX) / 2 + side * 2 * s;
    const kneeY = (hip + footY) / 2 + (duck ? 6 * s : 0);
    ctx.beginPath();
    ctx.moveTo(hipX, hip);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(footX, footY);
    ctx.stroke();
  }

  ctx.fillStyle = "#2f7d3f";
  ctx.beginPath();
  ctx.moveTo(x - 13 * s, shoulder);
  ctx.lineTo(x + 13 * s, shoulder);
  ctx.lineTo(x + 9 * s, hip);
  ctx.lineTo(x - 9 * s, hip);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1f5a2c";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x - 6 * s + i * 6 * s, shoulder + (6 + i * 9) * s, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "#caa06a";
  ctx.lineWidth = 5.5 * s;
  for (const side of [-1, 1]) {
    const sw = run ? Math.sin(stride + (side > 0 ? 0 : Math.PI)) : 0;
    const shX = x + side * shW;
    let handX, handY;
    if (airborne) { handX = shX + side * 7 * s; handY = shoulder - 6 * s; }
    else { handX = shX + sw * 4 * s; handY = shoulder + 20 * s - Math.max(0, sw) * 6 * s; }
    const elbowX = (shX + handX) / 2 + side * 3 * s;
    const elbowY = shoulder + 11 * s;
    ctx.beginPath();
    ctx.moveTo(shX, shoulder + 4 * s);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
  }

  ctx.strokeStyle = "#caa06a";
  ctx.lineWidth = 5 * s;
  ctx.beginPath(); ctx.moveTo(x, shoulder); ctx.lineTo(x, head + headR * 0.7); ctx.stroke();

  drawFace(x, head, headR);
}

function drawTrex() {
  const p = clamp((1.36 - trexT) / 0.4, 0, 1);
  const groundY = H + 120 - p * 360;
  const sc = 0.85 + p * 0.55;
  const open = 30 + p * 48 + Math.sin(frameCount * 0.3) * 6;
  drawRex(W / 2 - 285 * sc + player.laneX * 14, groundY, sc, open, frameCount * 0.4);
}

function drawCountdown(ts) {
  const left = 3 - (ts - calStart) / 1000;
  const n = Math.max(1, Math.ceil(left));
  ctx.fillStyle = "rgba(6,14,9,0.45)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4b03c";
  ctx.font = "700 28px Trebuchet MS, sans-serif";
  ctx.fillText("Snapping your face onto the runner…", W / 2, H / 2 - 110);
  ctx.fillStyle = bodyPresent ? "#6fe06f" : "#ef5350";
  ctx.font = "600 18px Trebuchet MS, sans-serif";
  ctx.fillText(bodyPresent ? "body locked — get ready!" : "step back so your whole body shows", W / 2, H / 2 - 74);
  ctx.fillStyle = "#eafbe9";
  ctx.font = "700 150px Bangers, Trebuchet MS, sans-serif";
  ctx.fillText(String(n), W / 2, H / 2 + 60);
  ctx.textAlign = "left";
}

function render(ts) {
  drawBackground();
  drawPath();

  const ordered = obstacles.slice().sort((a, b) => a.t - b.t);
  for (const p of props.slice().sort((a, b) => a.t - b.t)) if (p.t <= PLAYER_T) drawProp(p);
  for (const o of ordered) if (o.t <= PLAYER_T) drawObstacle(o);

  if (phase === "dead") drawTrex();
  if (phase === "playing") drawChaser();
  if (phase !== "calibrating") drawRunner();

  for (const o of ordered) if (o.t > PLAYER_T) drawObstacle(o);
  for (const p of props) if (p.t > PLAYER_T) drawProp(p);

  if (phase === "playing" && speed > 0.011) {
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const lx = 30 + i * 120;
      const ph = (worldScroll * 0.4 + i * 90) % 240;
      ctx.beginPath();
      ctx.moveTo(lx, ph);
      ctx.lineTo(lx + 8, ph + 60);
      ctx.stroke();
    }
  }

  if (phase === "calibrating") drawCountdown(ts);

  updateHud();
}

function updateHud() {
  elScore.textContent = String(score);
  elTime.textContent = elapsed.toFixed(1);
  elAction.textContent = phase === "playing" ? action : phase === "calibrating" ? "READY" : action;
  if (usingKb) { elStatus.textContent = "keyboard"; elStatus.style.color = "#38bdf8"; }
  else if (!wsReady) { elStatus.textContent = "link…"; elStatus.style.color = "#8fae93"; }
  else if (!camReady) { elStatus.textContent = "no cam"; elStatus.style.color = "#f4b03c"; }
  else if (bodyPresent) { elStatus.textContent = "tracking"; elStatus.style.color = "#6fe06f"; }
  else { elStatus.textContent = "show body"; elStatus.style.color = "#f4b03c"; }
}

function drawPip() {
  pctx.save();
  pctx.translate(pip.width, 0);
  pctx.scale(-1, 1);
  if (camReady) {
    pctx.drawImage(cam, 0, 0, pip.width, pip.height);
    pctx.restore();
    if (bodyPresent) {
      const mx = steer * pip.width;
      pctx.strokeStyle = "rgba(255,255,255,.85)";
      pctx.lineWidth = 2;
      pctx.beginPath(); pctx.moveTo(mx, 0); pctx.lineTo(mx, pip.height); pctx.stroke();
      pctx.fillStyle = "#6fe06f";
      pctx.beginPath(); pctx.arc(mx, pip.height / 2, 10, 0, Math.PI * 2); pctx.fill();
      const dy = clamp((bodyY - baselineY) * 4 + 0.5, 0, 1) * pip.height;
      pctx.fillStyle = (baselineY - bodyYSmooth > JUMP_THRESH) ? "#38bdf8" : (bodyYSmooth - baselineY > DUCK_THRESH) ? "#f4b03c" : "rgba(255,255,255,.5)";
      pctx.fillRect(pip.width - 10, dy - 3, 8, 6);
    }
  } else {
    pctx.restore();
    pctx.fillStyle = "#05100a";
    pctx.fillRect(0, 0, pip.width, pip.height);
    pctx.fillStyle = "#8fae93";
    pctx.font = "14px Trebuchet MS, sans-serif";
    pctx.textAlign = "center";
    pctx.fillText(usingKb ? "keyboard mode" : "waiting for camera", pip.width / 2, pip.height / 2);
    pctx.textAlign = "left";
  }
}

function frame(ts) {
  maybeSend(ts);
  update(ts);
  render(ts);
  drawPip();
  requestAnimationFrame(frame);
}

startBtn.addEventListener("click", async () => {
  if (window.Jungle) Jungle.start();
  if (!camReady) await initCam();
  beginCalibration();
});

muteBtn.addEventListener("click", () => {
  if (!window.Jungle) return;
  Jungle.start();
  const m = Jungle.toggle();
  muteBtn.textContent = m ? "SOUND: OFF" : "SOUND: ON";
});

fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (fsTarget.requestFullscreen) fsTarget.requestFullscreen();
  else if (fsTarget.webkitRequestFullscreen) fsTarget.webkitRequestFullscreen();
});

document.addEventListener("fullscreenchange", () => {
  fsBtn.textContent = document.fullscreenElement ? "EXIT FULL SCREEN" : "FULL SCREEN";
});

speedRange.addEventListener("input", () => {
  speedLevel = clamp(parseInt(speedRange.value, 10) || 2, 1, 4);
  speedName.textContent = SPEED_NAMES[speedLevel];
});

window.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "ArrowLeft") { KB.left = true; lastKbDown = performance.now(); }
  else if (k === "ArrowRight") { KB.right = true; lastKbDown = performance.now(); }
  else if (k === " " || k === "ArrowUp") { KB.jump = true; lastKbDown = performance.now(); e.preventDefault(); }
  else if (k === "ArrowDown") { KB.duck = true; lastKbDown = performance.now(); e.preventDefault(); }
  else if (k === "r" || k === "R") { if (phase === "playing" || phase === "dead") startRun(); }
  else if (k === "Enter") { if (phase === "ready") { if (window.Jungle) Jungle.start(); beginCalibration(); } }
});

window.addEventListener("keyup", (e) => {
  const k = e.key;
  if (k === "ArrowLeft") KB.left = false;
  else if (k === "ArrowRight") KB.right = false;
  else if (k === " " || k === "ArrowUp") KB.jump = false;
  else if (k === "ArrowDown") KB.duck = false;
});

connectWS();
initCam();
requestAnimationFrame(frame);

;
/* hold-readcontrols.js — steering-hold overlay (shipped in the live.js bundle
 * AND appended to the headless game source so offline training sees the SAME
 * control semantics as the live page).
 *
 * The vendored game lerps player.laneX toward 0 whenever no horizontal key is
 * held (readControls returns targetLane = 0), so NOOP/JUMP/DUCK all DRIFT the
 * fly back toward the center lane. To hold a safe side lane the old scheme
 * forced the policy to keep re-outputting LEFT/RIGHT, and any jump/duck floated
 * it out of its lane. This overlay inverts the default: NO horizontal key
 * means HOLD the current lane; only an explicit LEFT/RIGHT changes lane.
 *
 *   - LEFT/RIGHT            -> steer toward that lane
 *   - JUMP/DUCK / NOOP      -> stay in the current lane (never re-center)
 *   - bodyPresent (camera)  -> original vision autopilot, unless steering
 *
 * vendor/jurassic-runner/game.js remains byte-identical; this ships as an
 * overlay (same mechanism as the draw and crash overrides).
 */
function readControls(ts) {
  var kbHeld = KB.left || KB.right || KB.jump || KB.duck;
  usingKb = kbHeld || ts - lastKbDown < 200;
  var wantJump = false, wantDuck = false, targetLane;
  if (usingKb) { wantJump = KB.jump; wantDuck = KB.duck; }
  if (KB.left || KB.right) {
    targetLane = (KB.left ? -1 : 0) + (KB.right ? 1 : 0);
  } else if (bodyPresent) {
    var d = steer - 0.5;
    d = Math.sign(d) * Math.max(0, Math.abs(d) - LANE_DEAD);
    targetLane = clamp(d * LANE_GAIN, -1, 1);
    bodyYSmooth = lerp(bodyYSmooth, bodyY, 0.4);
    wantJump = baselineY - bodyYSmooth > JUMP_THRESH;
    wantDuck = bodyYSmooth - baselineY > DUCK_THRESH;
  } else {
    // AUTO / released keys: no horizontal input -> HOLD the current lane.
    targetLane = clamp(player.laneX, -1, 1);
  }
  return { targetLane, wantJump, wantDuck };
}
// ============ generated agent ============

// ============ FlyJump trained agent (generated) ============
(function () {
  "use strict";
  const CIRCUIT = {"version":"malecns-dino-circuit-v2-250","nodes":[{"id":10010,"type":"DNp01","position":[58238,22234,36276],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10030,"type":"pIP1","position":[56562,17820,34706],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10038,"type":"pIP1","position":[39330,19195,35528],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10063,"type":"DNp27","position":[34200,17553,36204],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10074,"type":"PVLP010","position":[62869,11945,19668],"nt":"glutamate","sign":-1,"role":"interneuron"},{"id":10145,"type":"PVLP130","position":[63384,22340,35354],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":10147,"type":"LHAD1g1","position":[73058,11486,25246],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":10173,"type":"PVLP151","position":[73609,20836,22268],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":10197,"type":"DNp02","position":[58903,20337,35171],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10228,"type":"DNp06","position":[59023,21254,36260],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10234,"type":"DNp35","position":[59209,19523,35768],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10259,"type":"DNp11","position":[59816,25251,37404],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10283,"type":"DNp103","position":[34618,24870,36898],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":10353,"type":"AVLP538","position":[29580,22155,35748],"nt":"unclear","sign":0,"role":"interneuron"},{"id":10361,"type":"DNg40","position":[51581,47658,27161],"nt":"glutamate","sign":-1,"role":"interneuron"},{"id":10417,"type":"DNp103","position":[61547,23883,37106],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":10558,"type":"DNp35","position":[38498,23136,36668],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10590,"type":"DNpe052","position":[59220,18642,36722],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10719,"type":"AVLP079","position":[23053,14740,25821],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":10752,"type":"DNp03","position":[53694,16558,30964],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10783,"type":"DNp09","position":[58758,21229,37805],"nt":"acetylcholine","sign":1,"role":"output"},{"id":10923,"type":"DNg40","position":[43712,47100,22322],"nt":"glutamate","sign":-1,"role":"output"},{"id":10936,"type":"LT61b","position":[73802,22777,22759],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":10992,"type":"PVLP122","position":[60475,25706,37951],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":10995,"type":"PVLP120","position":[37723,24091,37716],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":11177,"type":"DNp09","position":[37169,19527,37740],"nt":"acetylcholine","sign":1,"role":"output"},{"id":11252,"type":"PVLP017","position":[61388,21246,18279],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":11460,"type":"AVLP086","position":[22906,14718,24916],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":11472,"type":"PVLP015","position":[71370,19818,20043],"nt":"glutamate","sign":-1,"role":"interneuron"},{"id":11677,"type":"PVLP151","position":[24127,28055,21915],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":11826,"type":"PVLP151","position":[23733,26445,22130],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":11895,"type":"PVLP022","position":[61953,21741,17634],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":11927,"type":"PVLP122","position":[61536,30488,36680],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":12275,"type":"PVLP151","position":[73404,23146,21446],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":12957,"type":"LT61b","position":[23336,24808,23814],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":16475,"type":"PVLP024","position":[61864,23796,17365],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":16659,"type":"PVLP011","position":[36615,30011,21067],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":17478,"type":"LC4","position":[66418,32199,28481],"nt":"acetylcholine","sign":1,"role":"input"},{"id":17653,"type":"LC4","position":[66256,32511,28966],"nt":"acetylcholine","sign":1,"role":"input"},{"id":18149,"type":"PVLP096","position":[29030,19295,35901],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":18870,"type":"LC15","position":[65416,37646,26902],"nt":"acetylcholine","sign":1,"role":"input"},{"id":20176,"type":"LC11","position":[29040,20660,36692],"nt":"acetylcholine","sign":1,"role":"input"},{"id":21392,"type":"CB3400","position":[67416,34504,23158],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":21568,"type":"AVLP080","position":[24679,16248,27080],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":21570,"type":"LC11","position":[26768,18682,36400],"nt":"acetylcholine","sign":1,"role":"input"},{"id":22253,"type":"LPLC2","position":[71862,17860,31026],"nt":"acetylcholine","sign":1,"role":"input"},{"id":23781,"type":"LC11","position":[29510,22756,35386],"nt":"acetylcholine","sign":1,"role":"input"},{"id":23919,"type":"LPLC2","position":[65771,24959,36036],"nt":"acetylcholine","sign":1,"role":"input"},{"id":24187,"type":"LPLC2","position":[24607,18794,34051],"nt":"acetylcholine","sign":1,"role":"input"},{"id":24268,"type":"LPLC2","position":[26782,19748,34550],"nt":"acetylcholine","sign":1,"role":"input"},{"id":25525,"type":"LC15","position":[62960,39573,33949],"nt":"acetylcholine","sign":1,"role":"input"},{"id":25772,"type":"LC17","position":[31903,35770,28609],"nt":"acetylcholine","sign":1,"role":"input"},{"id":25873,"type":"LC17","position":[29092,32636,27746],"nt":"acetylcholine","sign":1,"role":"input"},{"id":26207,"type":"LC17","position":[30009,34532,26146],"nt":"acetylcholine","sign":1,"role":"input"},{"id":26617,"type":"LC17","position":[30621,34477,27774],"nt":"acetylcholine","sign":1,"role":"input"},{"id":26899,"type":"LC11","position":[22906,17418,35530],"nt":"acetylcholine","sign":1,"role":"input"},{"id":27624,"type":"LC4","position":[66089,30771,28818],"nt":"acetylcholine","sign":1,"role":"input"},{"id":29017,"type":"LC9","position":[23806,18714,33996],"nt":"acetylcholine","sign":1,"role":"input"},{"id":30663,"type":"LC16","position":[65394,34730,28946],"nt":"acetylcholine","sign":1,"role":"input"},{"id":32299,"type":"LC21","position":[31264,25556,36184],"nt":"acetylcholine","sign":1,"role":"input"},{"id":33480,"type":"LC15","position":[31989,39610,28284],"nt":"acetylcholine","sign":1,"role":"input"},{"id":33574,"type":"LC21","position":[30490,24454,36662],"nt":"acetylcholine","sign":1,"role":"input"},{"id":40131,"type":"LC9","position":[24764,19304,34141],"nt":"acetylcholine","sign":1,"role":"input"},{"id":40751,"type":"LC15","position":[63088,38828,32610],"nt":"acetylcholine","sign":1,"role":"input"},{"id":47016,"type":"LC16","position":[32740,37356,29602],"nt":"acetylcholine","sign":1,"role":"input"},{"id":47141,"type":"LC9","position":[72478,17044,32294],"nt":"acetylcholine","sign":1,"role":"input"},{"id":48070,"type":"LC21","position":[66196,22004,37015],"nt":"acetylcholine","sign":1,"role":"input"},{"id":57503,"type":"LC16","position":[31741,38012,28573],"nt":"acetylcholine","sign":1,"role":"input"},{"id":63084,"type":"LC16","position":[66856,35795,27429],"nt":"acetylcholine","sign":1,"role":"input"},{"id":65991,"type":"PVLP021","position":[61166,23026,16634],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":71157,"type":"CB3513","position":[65857,20818,16698],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":515900,"type":"LC4","position":[67389,32279,27764],"nt":"acetylcholine","sign":1,"role":"input"},{"id":518246,"type":"LC21","position":[66348,22968,37112],"nt":"acetylcholine","sign":1,"role":"input"},{"id":521326,"type":"AVLP259","position":[73314,20908,20522],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":523564,"type":"PVLP011","position":[60499,27648,19538],"nt":"gaba","sign":-1,"role":"interneuron"},{"id":523984,"type":"LC9","position":[72280,17378,32522],"nt":"acetylcholine","sign":1,"role":"input"},{"id":531898,"type":"DNp04","position":[57228,19519,38264],"nt":"acetylcholine","sign":1,"role":"output"},{"id":531899,"type":"AVLP452","position":[54729,34030,17250],"nt":"acetylcholine","sign":1,"role":"interneuron"},{"id":534040,"type":"PVLP015","position":[24165,21630,21692],"nt":"glutamate","sign":-1,"role":"interneuron"},{"id":536048,"type":"DNp27","position":[61126,16134,36332],"nt":"acetylcholine","sign":1,"role":"output"}],"edges":[[0,4,17],[0,6,2],[0,8,1],[0,9,3],[0,11,8],[0,12,2],[0,14,2],[0,15,10],[0,23,8],[0,26,2],[0,29,6],[0,30,4],[0,32,3],[0,35,1],[0,42,1],[0,45,1],[0,56,1],[0,70,1],[0,76,3],[0,77,8],[1,8,31],[1,20,2],[1,21,1],[1,31,9],[2,12,1],[2,16,1],[2,21,1],[2,43,3],[3,4,3],[3,7,2],[3,8,1],[3,9,1],[3,10,2],[3,11,1],[3,12,3],[3,13,4],[3,14,2],[3,15,5],[3,17,2],[3,18,3],[3,20,8],[3,22,2],[3,24,1],[3,25,5],[3,26,1],[3,27,5],[3,29,2],[3,30,2],[3,32,1],[3,33,2],[3,34,3],[3,36,1],[3,39,2],[3,40,2],[3,42,1],[3,43,6],[3,50,1],[3,62,1],[3,70,2],[3,74,3],[3,78,3],[3,79,11],[4,0,414],[4,1,15],[4,5,1],[4,6,40],[4,7,1],[4,8,68],[4,9,426],[4,10,55],[4,11,91],[4,14,213],[4,15,50],[4,17,4],[4,19,3],[4,20,2],[4,23,21],[4,26,1],[4,29,30],[4,30,30],[4,31,3],[4,32,17],[4,33,1],[4,35,4],[4,37,2],[4,38,3],[4,42,1],[4,69,4],[4,70,3],[4,71,2],[4,73,96],[4,74,2],[4,76,32],[4,77,147],[5,2,12],[5,13,18],[5,16,120],[5,17,1],[5,24,162],[5,28,4],[5,29,201],[5,30,159],[5,31,6],[5,33,1],[5,43,1],[5,73,1],[5,78,2],[6,0,188],[6,1,2],[6,4,23],[6,7,76],[6,8,24],[6,9,453],[6,10,77],[6,11,49],[6,14,261],[6,15,262],[6,17,2],[6,19,15],[6,20,7],[6,23,4],[6,26,2],[6,28,2],[6,29,3],[6,31,32],[6,33,71],[6,34,1],[6,37,4],[6,38,8],[6,45,1],[6,47,2],[6,71,7],[6,73,2],[6,74,1],[6,76,24],[6,77,5],[7,0,4],[7,6,1],[7,8,1],[7,9,6],[7,11,1],[7,12,99],[7,14,3],[7,15,7],[7,16,4],[7,21,86],[7,23,3],[7,24,4],[7,26,1],[7,28,1],[7,29,15],[7,30,17],[7,31,1],[7,33,6],[7,36,463],[7,37,1],[7,76,1],[7,78,12],[8,0,2],[8,1,2],[8,4,7],[8,9,1],[8,10,1],[8,11,3],[8,14,61],[8,15,1],[8,21,22],[8,76,14],[8,77,1],[9,0,8],[9,4,4],[9,7,1],[9,8,13],[9,12,7],[9,14,87],[9,15,7],[9,21,31],[9,29,1],[9,30,1],[9,76,3],[9,77,1],[10,8,3],[10,9,3],[10,14,2],[10,15,2],[10,16,3],[10,20,3],[10,21,3],[10,76,3],[11,0,5],[11,4,3],[11,7,1],[11,8,2],[11,9,1],[11,14,27],[11,17,1],[11,21,44],[11,28,1],[11,32,1],[11,35,1],[11,42,1],[11,69,1],[11,74,1],[11,79,1],[12,0,12],[12,7,6],[12,8,1],[12,9,11],[12,14,40],[12,15,47],[12,16,1],[12,18,2],[12,21,40],[12,24,2],[12,29,3],[12,30,1],[12,32,1],[12,33,2],[12,34,1],[12,43,3],[12,76,3],[13,2,24],[13,3,6],[13,5,2],[13,7,1],[13,12,8],[13,16,13],[13,18,39],[13,24,38],[13,25,4],[13,27,4],[13,29,7],[13,30,10],[13,36,46],[13,39,3],[13,43,54],[13,44,2],[13,46,1],[13,51,6],[13,53,4],[13,54,1],[13,57,2],[13,59,2],[13,78,4],[13,79,1],[14,0,14],[14,4,15],[14,6,51],[14,8,63],[14,9,3],[14,10,1],[14,11,4],[14,23,39],[14,29,1],[14,31,34],[14,32,13],[14,35,10],[14,69,9],[14,73,1],[14,74,10],[14,76,4],[14,77,4],[15,0,128],[15,3,1],[15,4,10],[15,6,16],[15,7,1],[15,8,6],[15,9,55],[15,11,1],[15,12,61],[15,14,7],[15,20,1],[15,21,45],[15,23,7],[15,26,3],[15,28,1],[15,29,6],[15,30,4],[15,32,19],[15,33,2],[15,45,2],[15,47,2],[15,56,1],[15,69,2],[15,70,1],[15,73,2],[15,76,5],[15,77,2],[16,10,4],[16,11,1],[16,12,1],[16,14,11],[16,21,12],[16,24,1],[16,25,1],[16,27,1],[16,43,1],[16,76,2],[17,1,8],[17,4,3],[17,6,4],[17,10,1],[17,15,2],[17,26,1],[17,28,4],[17,73,1],[17,76,1],[18,2,3],[18,3,1],[18,12,35],[18,13,11],[18,16,300],[18,21,3],[18,22,5],[18,24,38],[18,25,1],[18,27,16],[18,29,14],[18,30,38],[18,34,5],[18,41,17],[18,43,13],[18,44,18],[18,46,11],[18,55,17],[18,59,2],[18,61,1],[19,5,1],[19,8,1],[19,10,2],[19,11,1],[19,69,2],[20,1,1],[20,3,6],[20,10,1],[20,15,2],[20,17,2],[21,1,1],[21,7,1],[21,8,14],[21,11,2],[21,12,4],[21,30,1],[21,36,3],[21,76,2],[22,3,1],[22,9,102],[22,10,14],[22,11,6],[22,12,49],[22,15,61],[22,16,3],[22,17,2],[22,18,1],[22,23,4],[22,30,1],[22,32,48],[22,34,5],[22,35,20],[22,38,1],[22,39,1],[22,40,2],[22,43,1],[22,50,4],[22,58,1],[22,63,1],[22,66,1],[22,69,5],[22,70,4],[22,73,22],[22,75,1],[22,79,2],[23,0,219],[23,4,16],[23,6,7],[23,7,22],[23,8,13],[23,9,152],[23,10,8],[23,11,25],[23,12,4],[23,14,149],[23,15,76],[23,16,12],[23,20,1],[23,21,57],[23,22,2],[23,26,2],[23,28,10],[23,29,3],[23,30,3],[23,31,2],[23,32,48],[23,33,30],[23,35,3],[23,36,15],[23,37,4],[23,38,3],[23,43,2],[23,45,2],[23,47,2],[23,56,2],[23,69,1],[23,70,1],[23,71,1],[23,73,43],[23,76,4],[23,77,9],[23,78,12],[23,79,1],[24,5,1],[24,6,43],[24,7,9],[24,10,61],[24,12,2],[24,13,96],[24,16,38],[24,18,4],[24,26,13],[24,28,48],[24,30,1],[24,31,3],[24,32,11],[24,33,14],[24,36,11],[24,43,113],[24,69,7],[24,70,8],[24,73,1],[24,74,209],[24,76,20],[24,78,10],[25,16,2],[25,79,1],[26,0,48],[26,4,2],[26,5,2],[26,6,9],[26,7,41],[26,8,2],[26,9,43],[26,10,1],[26,11,4],[26,14,2],[26,15,40],[26,20,13],[26,23,3],[26,24,1],[26,28,20],[26,30,1],[26,32,2],[26,33,19],[26,34,1],[26,35,9],[26,40,1],[26,50,1],[26,63,3],[26,73,3],[26,74,2],[26,76,2],[26,79,2],[27,12,16],[27,13,1],[27,16,217],[27,18,16],[27,21,4],[27,22,6],[27,24,9],[27,29,1],[27,30,3],[27,34,5],[27,41,2],[27,43,3],[27,44,7],[27,46,2],[27,55,3],[27,59,2],[27,69,1],[27,73,2],[27,79,2],[28,0,2],[28,1,4],[28,4,2],[28,5,93],[28,7,4],[28,8,7],[28,9,17],[28,10,74],[28,11,44],[28,14,1],[28,15,16],[28,19,10],[28,20,1],[28,23,4],[28,24,1],[28,26,2],[28,31,84],[28,32,3],[28,33,10],[28,35,10],[28,42,2],[28,69,3],[28,70,1],[28,76,1],[28,77,7],[28,79,1],[29,0,164],[29,4,19],[29,6,13],[29,7,7],[29,9,153],[29,10,9],[29,11,3],[29,14,90],[29,15,82],[29,20,1],[29,23,28],[29,24,2],[29,26,10],[29,30,9],[29,31,16],[29,32,38],[29,33,26],[29,34,2],[29,35,12],[29,36,7],[29,42,11],[29,47,1],[29,69,3],[29,70,3],[29,73,16],[29,74,260],[29,76,25],[29,77,4],[29,78,1],[30,0,162],[30,4,16],[30,6,3],[30,7,16],[30,9,165],[30,11,3],[30,12,9],[30,14,53],[30,15,104],[30,19,7],[30,20,2],[30,21,1],[30,23,32],[30,26,21],[30,28,7],[30,29,7],[30,31,15],[30,32,39],[30,33,25],[30,35,22],[30,36,8],[30,42,10],[30,45,1],[30,47,4],[30,69,3],[30,70,4],[30,73,20],[30,74,217],[30,76,41],[30,77,1],[31,1,20],[31,2,50],[31,5,29],[31,9,1],[31,11,1],[31,12,1],[31,19,1],[31,28,9],[31,29,2],[31,30,2],[31,33,2],[31,35,4],[31,69,2],[31,78,99],[32,0,258],[32,4,9],[32,5,14],[32,6,4],[32,7,26],[32,8,11],[32,9,201],[32,10,72],[32,11,47],[32,12,16],[32,14,21],[32,15,175],[32,16,26],[32,19,1],[32,21,4],[32,23,30],[32,26,3],[32,28,9],[32,29,4],[32,30,3],[32,31,1],[32,33,11],[32,34,4],[32,38,5],[32,70,4],[32,71,1],[32,73,49],[32,76,3],[32,77,5],[33,0,4],[33,7,6],[33,10,5],[33,12,104],[33,13,1],[33,14,6],[33,15,1],[33,16,1],[33,21,86],[33,22,1],[33,23,1],[33,24,2],[33,25,1],[33,29,17],[33,30,10],[33,36,401],[33,45,7],[33,47,5],[33,78,19],[34,3,1],[34,4,2],[34,9,47],[34,10,38],[34,12,66],[34,14,3],[34,15,34],[34,16,23],[34,18,1],[34,21,29],[34,22,4],[34,23,3],[34,26,2],[34,27,1],[34,29,3],[34,30,3],[34,32,31],[34,36,1],[34,41,1],[34,43,7],[34,46,1],[34,55,2],[34,61,2],[34,70,4],[34,73,53],[35,0,49],[35,4,7],[35,5,9],[35,7,3],[35,8,5],[35,9,7],[35,10,4],[35,11,33],[35,12,1],[35,14,1],[35,15,3],[35,16,9],[35,19,23],[35,23,4],[35,28,25],[35,29,6],[35,30,3],[35,31,61],[35,32,1],[35,33,4],[35,37,6],[35,38,10],[35,56,11],[35,71,6],[35,76,7],[35,77,1],[36,2,3],[36,5,1],[36,7,21],[36,12,11],[36,13,9],[36,16,21],[36,21,97],[36,24,18],[36,29,98],[36,30,59],[36,32,1],[36,33,13],[36,34,1],[36,43,4],[36,48,77],[36,49,87],[36,51,160],[36,52,112],[36,53,112],[36,54,107],[36,78,114],[37,0,86],[37,4,23],[37,5,8],[37,6,10],[37,7,7],[37,8,53],[37,9,19],[37,10,5],[37,11,12],[37,14,3],[37,15,7],[37,19,43],[37,22,8],[37,23,24],[37,28,4],[37,31,14],[37,32,28],[37,33,4],[37,35,34],[37,38,6],[37,42,13],[37,69,9],[37,70,11],[37,71,11],[37,73,7],[37,74,2],[37,76,125],[37,77,22],[38,0,83],[38,4,44],[38,5,3],[38,6,15],[38,7,11],[38,8,55],[38,9,20],[38,10,3],[38,11,5],[38,14,1],[38,15,9],[38,19,48],[38,22,13],[38,23,10],[38,31,33],[38,32,28],[38,33,9],[38,35,43],[38,37,6],[38,42,15],[38,69,10],[38,70,3],[38,71,13],[38,73,10],[38,74,7],[38,76,147],[38,77,10],[39,12,14],[39,13,12],[39,16,51],[39,18,1],[39,22,1],[39,24,12],[39,27,17],[39,29,2],[39,30,4],[39,41,7],[39,43,2],[39,44,1],[39,46,9],[39,55,3],[40,3,2],[40,7,11],[40,22,13],[40,26,11],[40,33,1],[40,50,1],[40,63,1],[40,66,1],[41,13,9],[41,16,34],[41,18,27],[41,24,2],[41,27,27],[41,34,35],[41,39,3],[41,43,13],[41,46,1],[41,55,1],[41,79,1],[42,7,3],[42,8,2],[42,9,21],[42,10,12],[42,15,17],[42,19,1],[42,23,6],[42,28,1],[42,31,1],[42,32,89],[42,35,3],[42,37,1],[42,70,1],[42,73,3],[42,74,1],[42,76,22],[42,77,8],[43,2,4],[43,3,2],[43,5,2],[43,12,256],[43,13,4],[43,16,435],[43,18,8],[43,22,1],[43,24,113],[43,25,19],[43,27,2],[43,29,6],[43,30,1],[43,34,1],[43,41,1],[43,44,1],[43,46,2],[43,51,14],[43,52,10],[43,53,9],[43,54,11],[43,55,1],[43,61,1],[43,78,3],[44,13,30],[44,16,34],[44,18,35],[44,24,10],[44,27,27],[44,34,25],[44,39,7],[44,43,13],[44,53,10],[44,55,4],[45,0,60],[45,3,1],[45,5,14],[45,6,22],[45,7,16],[45,9,10],[45,10,4],[45,11,1],[45,14,26],[45,15,37],[45,17,1],[45,23,1],[45,24,1],[45,26,3],[45,30,1],[45,31,4],[45,33,30],[45,35,1],[45,47,3],[45,74,68],[45,76,42],[46,13,23],[46,16,37],[46,18,21],[46,24,8],[46,27,11],[46,29,1],[46,34,23],[46,39,2],[46,41,3],[46,43,18],[46,55,7],[46,67,3],[47,0,47],[47,4,1],[47,5,10],[47,6,10],[47,7,8],[47,9,13],[47,10,1],[47,11,2],[47,14,37],[47,15,15],[47,20,10],[47,23,12],[47,26,3],[47,28,3],[47,29,1],[47,30,3],[47,31,2],[47,33,19],[47,45,1],[47,70,2],[47,73,1],[47,74,50],[47,76,14],[47,77,2],[47,79,1],[48,12,29],[48,16,1],[48,21,57],[48,24,11],[48,25,1],[48,29,27],[48,30,7],[48,36,111],[48,49,8],[48,78,7],[49,7,1],[49,12,40],[49,16,2],[49,21,40],[49,24,5],[49,25,4],[49,29,27],[49,30,18],[49,36,111],[49,48,10],[49,78,11],[50,7,6],[50,11,1],[50,22,24],[50,26,11],[50,33,2],[50,40,1],[51,7,1],[51,13,73],[51,16,20],[51,24,73],[51,29,13],[51,30,5],[51,36,192],[51,43,1],[51,52,3],[51,54,3],[52,13,43],[52,16,16],[52,24,73],[52,29,5],[52,30,3],[52,36,142],[52,43,1],[52,51,6],[52,53,4],[52,54,2],[53,13,58],[53,16,16],[53,24,42],[53,29,10],[53,30,6],[53,36,129],[53,51,1],[53,52,7],[53,54,2],[54,13,75],[54,16,21],[54,24,60],[54,29,10],[54,30,2],[54,36,124],[54,51,3],[54,52,4],[54,53,1],[55,13,11],[55,16,35],[55,18,28],[55,24,5],[55,27,16],[55,34,27],[55,39,4],[55,41,4],[55,43,8],[55,44,2],[55,46,4],[56,0,51],[56,4,3],[56,5,34],[56,6,3],[56,7,9],[56,8,18],[56,9,15],[56,10,4],[56,11,67],[56,14,26],[56,15,4],[56,19,49],[56,23,15],[56,28,9],[56,31,1],[56,32,20],[56,33,8],[56,35,32],[56,42,25],[56,69,38],[56,70,28],[56,73,14],[56,74,21],[56,76,148],[56,77,18],[57,16,6],[57,24,1],[57,25,30],[57,62,12],[57,78,38],[58,1,33],[58,22,1],[58,33,1],[59,13,2],[59,16,24],[59,18,1],[59,29,1],[59,34,8],[59,39,9],[59,61,5],[60,3,1],[60,29,16],[60,30,20],[60,34,4],[60,39,7],[60,52,1],[60,61,9],[61,13,5],[61,16,25],[61,18,2],[61,30,1],[61,34,4],[61,39,19],[61,46,1],[61,52,8],[61,59,6],[61,60,1],[62,3,1],[62,16,7],[62,24,3],[62,25,36],[62,34,1],[62,57,19],[62,78,22],[63,7,4],[63,17,2],[63,22,11],[63,26,19],[63,33,2],[63,50,1],[63,72,3],[64,2,28],[64,29,1],[65,5,1],[65,10,6],[65,20,45],[65,28,6],[65,33,1],[65,75,6],[66,7,2],[66,10,28],[66,22,3],[66,33,3],[66,40,1],[66,72,3],[67,2,29],[67,18,2],[67,46,2],[67,64,2],[68,1,33],[68,33,4],[69,0,3],[69,1,3],[69,2,10],[69,4,1],[69,5,24],[69,6,6],[69,7,1],[69,8,5],[69,9,1],[69,10,2],[69,11,13],[69,14,1],[69,15,2],[69,19,18],[69,23,3],[69,26,1],[69,27,2],[69,28,2],[69,30,1],[69,31,1],[69,32,5],[69,35,1],[69,56,1],[69,73,4],[69,76,1],[69,77,54],[70,0,40],[70,4,3],[70,6,5],[70,7,5],[70,8,6],[70,9,1],[70,10,1],[70,11,9],[70,12,1],[70,14,1],[70,15,2],[70,17,1],[70,19,5],[70,20,1],[70,22,1],[70,23,3],[70,27,1],[70,28,1],[70,29,5],[70,32,32],[70,35,1],[70,37,6],[70,38,1],[70,42,4],[70,56,5],[70,71,4],[70,73,7],[70,74,1],[70,76,13],[70,77,2],[70,79,1],[71,0,54],[71,4,42],[71,5,5],[71,6,17],[71,7,1],[71,8,52],[71,9,26],[71,10,24],[71,11,2],[71,14,2],[71,15,7],[71,19,42],[71,22,5],[71,23,15],[71,31,35],[71,32,30],[71,33,18],[71,35,54],[71,37,14],[71,38,9],[71,42,26],[71,69,21],[71,70,9],[71,73,19],[71,74,6],[71,76,158],[71,77,25],[72,7,1],[72,10,23],[72,22,2],[72,33,1],[72,66,3],[73,4,3],[73,6,1],[73,8,1],[73,9,33],[73,10,74],[73,11,3],[73,12,2],[73,13,1],[73,14,1],[73,16,4],[73,17,3],[73,23,3],[73,26,2],[73,32,3],[73,76,3],[73,79,1],[74,0,4],[74,4,4],[74,5,8],[74,6,4],[74,7,65],[74,9,9],[74,10,18],[74,11,4],[74,14,55],[74,15,1],[74,17,1],[74,19,5],[74,23,1],[74,24,9],[74,26,3],[74,28,98],[74,29,9],[74,30,4],[74,31,3],[74,32,1],[74,33,64],[74,35,1],[74,38,7],[74,45,68],[74,47,42],[74,56,11],[74,70,2],[74,71,6],[74,73,1],[74,76,6],[74,79,1],[75,5,1],[75,10,1],[75,11,28],[75,20,45],[75,28,30],[75,65,4],[76,0,2],[76,4,222],[76,5,1],[76,6,58],[76,7,41],[76,8,17],[76,9,23],[76,10,106],[76,12,1],[76,14,41],[76,15,26],[76,21,7],[76,23,61],[76,26,1],[76,29,1],[76,30,2],[76,32,51],[76,33,12],[76,35,1],[76,38,1],[76,42,8],[76,70,1],[76,71,1],[76,73,33],[76,74,1],[76,77,49],[77,0,98],[77,4,28],[77,6,4],[77,8,18],[77,9,62],[77,10,13],[77,11,5],[77,14,3],[77,15,12],[77,23,6],[77,26,3],[77,31,1],[77,32,13],[77,35,2],[77,37,2],[77,38,1],[77,47,1],[77,73,15],[77,76,4],[78,2,8],[78,3,1],[78,12,15],[78,13,4],[78,16,86],[78,21,3],[78,25,4],[78,29,3],[78,30,5],[78,31,2],[78,36,2],[78,57,4],[78,62,2],[79,1,2],[79,3,9],[79,4,2],[79,5,1],[79,6,2],[79,7,1],[79,9,1],[79,11,2],[79,12,1],[79,13,3],[79,14,1],[79,15,5],[79,17,7],[79,18,11],[79,20,1],[79,21,2],[79,22,1],[79,23,1],[79,25,2],[79,26,2],[79,27,2],[79,28,2],[79,30,3],[79,33,2],[79,34,2],[79,39,1],[79,43,3],[79,67,1],[79,69,4],[79,70,1],[79,73,2],[79,74,2]],"inputs":[[38,0],[37,0],[71,0],[56,0],[46,1],[41,1],[55,1],[44,1],[75,2],[65,2],[57,2],[62,2],[40,3],[63,3],[50,3],[60,3],[58,4],[68,4],[67,4],[64,4],[54,5],[51,5],[52,5],[53,5],[66,6],[61,6],[59,6],[72,6],[45,7],[48,7],[49,7],[47,7]],"outputs":[76,0,16,79,20,25,3,17,1,2,10,21,19,8,11,9],"channels":["LC4","LC11","LC9","LC15","LC16","LC17","LC21","LPLC2"]};
  const W_EDGES = [[0,4,0.031835205992509365],[0,6,0.005714285714285714],[0,8,0.0020242914979757085],[0,9,0.0014251781472684087],[0,11,0.016597510373443983],[0,12,0.0023501762632197414],[0,14,0.0016129032258064516],[0,15,0.008841732979664015],[0,23,0.022727272727272728],[0,26,0.016260162601626018],[0,29,0.0106951871657754],[0,30,0.009070294784580499],[0,32,0.005199306759098787],[0,35,0.0037174721189591076],[0,42,0.00847457627118644],[0,45,0.012048192771084338],[0,56,0.03125],[0,70,0.010638297872340425],[0,76,0.0033975084937712344],[0,77,0.02077922077922078],[1,8,0.06275303643724696],[1,20,0.013986013986013986],[1,21,0.0014814814814814814],[1,31,0.024725274725274724],[2,12,0.0011750881316098707],[2,16,0.0006116207951070336],[2,21,0.0014814814814814814],[2,43,0.013888888888888888],[3,4,0.0056179775280898875],[3,7,0.0045662100456621],[3,8,0.0020242914979757085],[3,9,0.00047505938242280285],[3,10,0.0026490066225165563],[3,11,0.002074688796680498],[3,12,0.0035252643948296123],[3,13,0.008113590263691683],[3,14,0.0016129032258064516],[3,15,0.004420866489832007],[3,17,0.06896551724137931],[3,18,0.018404907975460124],[3,20,0.055944055944055944],[3,22,0.019230769230769232],[3,24,0.0014947683109118087],[3,25,0.04807692307692308],[3,26,0.008130081300813009],[3,27,0.0390625],[3,29,0.0035650623885918],[3,30,0.0045351473922902496],[3,32,0.0017331022530329288],[3,33,0.004761904761904762],[3,34,0.0189873417721519],[3,36,0.0005810575246949448],[3,39,0.03636363636363636],[3,40,0.2857142857142857],[3,42,0.00847457627118644],[3,43,0.027777777777777776],[3,50,0.125],[3,62,0.06666666666666667],[3,70,0.02127659574468085],[3,74,0.003472222222222222],[3,78,0.0084985835694051],[3,79,0.4230769230769231],[4,0,-0.18741511996378452],[4,1,-0.12096774193548387],[4,5,-0.0038022813688212928],[4,6,-0.11428571428571428],[4,7,-0.00228310502283105],[4,8,-0.13765182186234817],[4,9,-0.202375296912114],[4,10,-0.0728476821192053],[4,11,-0.1887966804979253],[4,14,-0.1717741935483871],[4,15,-0.04420866489832007],[4,17,-0.13793103448275862],[4,19,-0.01107011070110701],[4,20,-0.013986013986013986],[4,23,-0.05965909090909091],[4,26,-0.008130081300813009],[4,29,-0.053475935828877004],[4,30,-0.06802721088435375],[4,31,-0.008241758241758242],[4,32,-0.029462738301559793],[4,33,-0.002380952380952381],[4,35,-0.01486988847583643],[4,37,-0.043478260869565216],[4,38,-0.05454545454545454],[4,42,-0.00847457627118644],[4,69,-0.032],[4,70,-0.031914893617021274],[4,71,-0.038461538461538464],[4,73,-0.22429906542056074],[4,74,-0.0023148148148148147],[4,76,-0.0362400906002265],[4,77,-0.38181818181818183],[5,2,-0.08163265306122448],[5,13,-0.036511156186612576],[5,16,-0.07339449541284404],[5,17,-0.034482758620689655],[5,24,-0.242152466367713],[5,28,-0.013468013468013467],[5,29,-0.3582887700534759],[5,30,-0.36054421768707484],[5,31,-0.016483516483516484],[5,33,-0.002380952380952381],[5,43,-0.004629629629629629],[5,73,-0.002336448598130841],[5,78,-0.0056657223796034],[6,0,-0.0851063829787234],[6,1,-0.016129032258064516],[6,4,-0.04307116104868914],[6,7,-0.1735159817351598],[6,8,-0.048582995951417005],[6,9,-0.2152019002375297],[6,10,-0.10198675496688742],[6,11,-0.1016597510373444],[6,14,-0.21048387096774193],[6,15,-0.23165340406719717],[6,17,-0.06896551724137931],[6,19,-0.055350553505535055],[6,20,-0.04895104895104895],[6,23,-0.011363636363636364],[6,26,-0.016260162601626018],[6,28,-0.006734006734006734],[6,29,-0.0053475935828877],[6,31,-0.08791208791208792],[6,33,-0.16904761904761906],[6,34,-0.006329113924050633],[6,37,-0.08695652173913043],[6,38,-0.14545454545454545],[6,45,-0.012048192771084338],[6,47,-0.03225806451612903],[6,71,-0.1346153846153846],[6,73,-0.004672897196261682],[6,74,-0.0011574074074074073],[6,76,-0.027180067950169876],[6,77,-0.012987012987012988],[7,0,0.0018107741059302852],[7,6,0.002857142857142857],[7,8,0.0020242914979757085],[7,9,0.0028503562945368173],[7,11,0.002074688796680498],[7,12,0.11633372502937721],[7,14,0.0024193548387096775],[7,15,0.00618921308576481],[7,16,0.0024464831804281344],[7,21,0.1274074074074074],[7,23,0.008522727272727272],[7,24,0.005979073243647235],[7,26,0.008130081300813009],[7,28,0.003367003367003367],[7,29,0.026737967914438502],[7,30,0.03854875283446712],[7,31,0.0027472527472527475],[7,33,0.014285714285714285],[7,36,0.26902963393375945],[7,37,0.021739130434782608],[7,76,0.0011325028312570782],[7,78,0.0339943342776204],[8,0,0.0009053870529651426],[8,1,0.016129032258064516],[8,4,0.013108614232209739],[8,9,0.00047505938242280285],[8,10,0.0013245033112582781],[8,11,0.006224066390041493],[8,14,0.049193548387096775],[8,15,0.0008841732979664014],[8,21,0.03259259259259259],[8,76,0.015855039637599093],[8,77,0.0025974025974025974],[9,0,0.0036215482118605704],[9,4,0.00749063670411985],[9,7,0.00228310502283105],[9,8,0.02631578947368421],[9,12,0.008225616921269096],[9,14,0.07016129032258064],[9,15,0.00618921308576481],[9,21,0.045925925925925926],[9,29,0.0017825311942959],[9,30,0.0022675736961451248],[9,76,0.0033975084937712344],[9,77,0.0025974025974025974],[10,8,0.006072874493927126],[10,9,0.0014251781472684087],[10,14,0.0016129032258064516],[10,15,0.0017683465959328027],[10,16,0.001834862385321101],[10,20,0.02097902097902098],[10,21,0.0044444444444444444],[10,76,0.0033975084937712344],[11,0,0.0022634676324128564],[11,4,0.0056179775280898875],[11,7,0.00228310502283105],[11,8,0.004048582995951417],[11,9,0.00047505938242280285],[11,14,0.021774193548387097],[11,17,0.034482758620689655],[11,21,0.06518518518518518],[11,28,0.003367003367003367],[11,32,0.0017331022530329288],[11,35,0.0037174721189591076],[11,42,0.00847457627118644],[11,69,0.008],[11,74,0.0011574074074074073],[11,79,0.038461538461538464],[12,0,0.005432322317790856],[12,7,0.0136986301369863],[12,8,0.0020242914979757085],[12,9,0.005225653206650831],[12,14,0.03225806451612903],[12,15,0.04155614500442087],[12,16,0.0006116207951070336],[12,18,0.012269938650306749],[12,21,0.05925925925925926],[12,24,0.0029895366218236174],[12,29,0.0053475935828877],[12,30,0.0022675736961451248],[12,32,0.0017331022530329288],[12,33,0.004761904761904762],[12,34,0.006329113924050633],[12,43,0.013888888888888888],[12,76,0.0033975084937712344],[13,2,0],[13,3,0],[13,5,0],[13,7,0],[13,12,0],[13,16,0],[13,18,0],[13,24,0],[13,25,0],[13,27,0],[13,29,0],[13,30,0],[13,36,0],[13,39,0],[13,43,0],[13,44,0],[13,46,0],[13,51,0],[13,53,0],[13,54,0],[13,57,0],[13,59,0],[13,78,0],[13,79,0],[14,0,-0.006337709370755998],[14,4,-0.028089887640449437],[14,6,-0.1457142857142857],[14,8,-0.12753036437246965],[14,9,-0.0014251781472684087],[14,10,-0.0013245033112582781],[14,11,-0.008298755186721992],[14,23,-0.11079545454545454],[14,29,-0.0017825311942959],[14,31,-0.09340659340659341],[14,32,-0.022530329289428077],[14,35,-0.03717472118959108],[14,69,-0.072],[14,73,-0.002336448598130841],[14,74,-0.011574074074074073],[14,76,-0.004530011325028313],[14,77,-0.01038961038961039],[15,0,0.057944771389769126],[15,3,0.037037037037037035],[15,4,0.018726591760299626],[15,6,0.045714285714285714],[15,7,0.00228310502283105],[15,8,0.012145748987854251],[15,9,0.026128266033254157],[15,11,0.002074688796680498],[15,12,0.07168037602820211],[15,14,0.00564516129032258],[15,20,0.006993006993006993],[15,21,0.06666666666666667],[15,23,0.019886363636363636],[15,26,0.024390243902439025],[15,28,0.003367003367003367],[15,29,0.0106951871657754],[15,30,0.009070294784580499],[15,32,0.03292894280762565],[15,33,0.004761904761904762],[15,45,0.024096385542168676],[15,47,0.03225806451612903],[15,56,0.03125],[15,69,0.016],[15,70,0.010638297872340425],[15,73,0.004672897196261682],[15,76,0.0056625141562853904],[15,77,0.005194805194805195],[16,10,0.005298013245033113],[16,11,0.002074688796680498],[16,12,0.0011750881316098707],[16,14,0.008870967741935484],[16,21,0.017777777777777778],[16,24,0.0014947683109118087],[16,25,0.009615384615384616],[16,27,0.0078125],[16,43,0.004629629629629629],[16,76,0.0022650056625141564],[17,1,0.06451612903225806],[17,4,0.0056179775280898875],[17,6,0.011428571428571429],[17,10,0.0013245033112582781],[17,15,0.0017683465959328027],[17,26,0.008130081300813009],[17,28,0.013468013468013467],[17,73,0.002336448598130841],[17,76,0.0011325028312570782],[18,2,-0.02040816326530612],[18,3,-0.037037037037037035],[18,12,-0.041128084606345476],[18,13,-0.02231237322515213],[18,16,-0.1834862385321101],[18,21,-0.0044444444444444444],[18,22,-0.04807692307692308],[18,24,-0.05680119581464873],[18,25,-0.009615384615384616],[18,27,-0.125],[18,29,-0.024955436720142603],[18,30,-0.08616780045351474],[18,34,-0.03164556962025317],[18,41,-0.4857142857142857],[18,43,-0.06018518518518518],[18,44,-0.6206896551724138],[18,46,-0.3333333333333333],[18,55,-0.4473684210526316],[18,59,-0.2],[18,61,-0.05555555555555555],[19,5,0.0038022813688212928],[19,8,0.0020242914979757085],[19,10,0.0026490066225165563],[19,11,0.002074688796680498],[19,69,0.016],[20,1,0.008064516129032258],[20,3,0.2222222222222222],[20,10,0.0013245033112582781],[20,15,0.0017683465959328027],[20,17,0.06896551724137931],[21,1,-0.008064516129032258],[21,7,-0.00228310502283105],[21,8,-0.02834008097165992],[21,11,-0.004149377593360996],[21,12,-0.004700352526439483],[21,30,-0.0022675736961451248],[21,36,-0.0017431725740848344],[21,76,-0.0022650056625141564],[22,3,0.037037037037037035],[22,9,0.048456057007125894],[22,10,0.018543046357615896],[22,11,0.012448132780082987],[22,12,0.057579318448883664],[22,15,0.053934571175950484],[22,16,0.001834862385321101],[22,17,0.06896551724137931],[22,18,0.006134969325153374],[22,23,0.011363636363636364],[22,30,0.0022675736961451248],[22,32,0.0831889081455806],[22,34,0.03164556962025317],[22,35,0.07434944237918216],[22,38,0.01818181818181818],[22,39,0.01818181818181818],[22,40,0.2857142857142857],[22,43,0.004629629629629629],[22,50,0.5],[22,58,1],[22,63,0.2],[22,66,0.2],[22,69,0.04],[22,70,0.0425531914893617],[22,73,0.0514018691588785],[22,75,0.14285714285714285],[22,79,0.07692307692307693],[23,0,0.09913988229968311],[23,4,0.0299625468164794],[23,6,0.02],[23,7,0.0502283105022831],[23,8,0.02631578947368421],[23,9,0.07220902612826603],[23,10,0.010596026490066225],[23,11,0.05186721991701245],[23,12,0.004700352526439483],[23,14,0.12016129032258065],[23,15,0.0671971706454465],[23,16,0.007339449541284404],[23,20,0.006993006993006993],[23,21,0.08444444444444445],[23,22,0.019230769230769232],[23,26,0.016260162601626018],[23,28,0.03367003367003367],[23,29,0.0053475935828877],[23,30,0.006802721088435374],[23,31,0.005494505494505495],[23,32,0.0831889081455806],[23,33,0.07142857142857142],[23,35,0.011152416356877323],[23,36,0.008715862870424172],[23,37,0.08695652173913043],[23,38,0.05454545454545454],[23,43,0.009259259259259259],[23,45,0.024096385542168676],[23,47,0.03225806451612903],[23,56,0.0625],[23,69,0.008],[23,70,0.010638297872340425],[23,71,0.019230769230769232],[23,73,0.10046728971962617],[23,76,0.004530011325028313],[23,77,0.023376623376623377],[23,78,0.0339943342776204],[23,79,0.038461538461538464],[24,5,0.0038022813688212928],[24,6,0.12285714285714286],[24,7,0.02054794520547945],[24,10,0.08079470198675497],[24,12,0.0023501762632197414],[24,13,0.1947261663286004],[24,16,0.023241590214067277],[24,18,0.024539877300613498],[24,26,0.10569105691056911],[24,28,0.16161616161616163],[24,30,0.0022675736961451248],[24,31,0.008241758241758242],[24,32,0.019064124783362217],[24,33,0.03333333333333333],[24,36,0.006391632771644393],[24,43,0.5231481481481481],[24,69,0.056],[24,70,0.0851063829787234],[24,73,0.002336448598130841],[24,74,0.24189814814814814],[24,76,0.022650056625141562],[24,78,0.028328611898016998],[25,16,0.0012232415902140672],[25,79,0.038461538461538464],[26,0,-0.021729289271163424],[26,4,-0.003745318352059925],[26,5,-0.0076045627376425855],[26,6,-0.025714285714285714],[26,7,-0.09360730593607305],[26,8,-0.004048582995951417],[26,9,-0.020427553444180523],[26,10,-0.0013245033112582781],[26,11,-0.008298755186721992],[26,14,-0.0016129032258064516],[26,15,-0.03536693191865606],[26,20,-0.09090909090909091],[26,23,-0.008522727272727272],[26,24,-0.0014947683109118087],[26,28,-0.06734006734006734],[26,30,-0.0022675736961451248],[26,32,-0.0034662045060658577],[26,33,-0.04523809523809524],[26,34,-0.006329113924050633],[26,35,-0.03345724907063197],[26,40,-0.14285714285714285],[26,50,-0.125],[26,63,-0.6],[26,73,-0.007009345794392523],[26,74,-0.0023148148148148147],[26,76,-0.0022650056625141564],[26,79,-0.07692307692307693],[27,12,-0.01880141010575793],[27,13,-0.002028397565922921],[27,16,-0.1327217125382263],[27,18,-0.09815950920245399],[27,21,-0.005925925925925926],[27,22,-0.057692307692307696],[27,24,-0.013452914798206279],[27,29,-0.0017825311942959],[27,30,-0.006802721088435374],[27,34,-0.03164556962025317],[27,41,-0.05714285714285714],[27,43,-0.013888888888888888],[27,44,-0.2413793103448276],[27,46,-0.06060606060606061],[27,55,-0.07894736842105263],[27,59,-0.2],[27,69,-0.008],[27,73,-0.004672897196261682],[27,79,-0.07692307692307693],[28,0,-0.0009053870529651426],[28,1,-0.03225806451612903],[28,4,-0.003745318352059925],[28,5,-0.35361216730038025],[28,7,-0.0091324200913242],[28,8,-0.01417004048582996],[28,9,-0.008076009501187649],[28,10,-0.09801324503311258],[28,11,-0.0912863070539419],[28,14,-0.0008064516129032258],[28,15,-0.014146772767462422],[28,19,-0.03690036900369004],[28,20,-0.006993006993006993],[28,23,-0.011363636363636364],[28,24,-0.0014947683109118087],[28,26,-0.016260162601626018],[28,31,-0.23076923076923078],[28,32,-0.005199306759098787],[28,33,-0.023809523809523808],[28,35,-0.03717472118959108],[28,42,-0.01694915254237288],[28,69,-0.024],[28,70,-0.010638297872340425],[28,76,-0.0011325028312570782],[28,77,-0.01818181818181818],[28,79,-0.038461538461538464],[29,0,0.0742417383431417],[29,4,0.035580524344569285],[29,6,0.037142857142857144],[29,7,0.01598173515981735],[29,9,0.07268408551068883],[29,10,0.011920529801324504],[29,11,0.006224066390041493],[29,14,0.07258064516129033],[29,15,0.07250221043324491],[29,20,0.006993006993006993],[29,23,0.07954545454545454],[29,24,0.0029895366218236174],[29,26,0.08130081300813008],[29,30,0.02040816326530612],[29,31,0.04395604395604396],[29,32,0.0658578856152513],[29,33,0.06190476190476191],[29,34,0.012658227848101266],[29,35,0.04460966542750929],[29,36,0.004067402672864613],[29,42,0.09322033898305085],[29,47,0.016129032258064516],[29,69,0.024],[29,70,0.031914893617021274],[29,73,0.037383177570093455],[29,74,0.30092592592592593],[29,76,0.028312570781426953],[29,77,0.01038961038961039],[29,78,0.0028328611898017],[30,0,0.07333635129017656],[30,4,0.0299625468164794],[30,6,0.008571428571428572],[30,7,0.0365296803652968],[30,9,0.07838479809976247],[30,11,0.006224066390041493],[30,12,0.010575793184488837],[30,14,0.042741935483870966],[30,15,0.09195402298850575],[30,19,0.025830258302583026],[30,20,0.013986013986013986],[30,21,0.0014814814814814814],[30,23,0.09090909090909091],[30,26,0.17073170731707318],[30,28,0.02356902356902357],[30,29,0.012477718360071301],[30,31,0.04120879120879121],[30,32,0.06759098786828423],[30,33,0.05952380952380952],[30,35,0.08178438661710037],[30,36,0.004648460197559558],[30,42,0.0847457627118644],[30,45,0.012048192771084338],[30,47,0.06451612903225806],[30,69,0.024],[30,70,0.0425531914893617],[30,73,0.04672897196261682],[30,74,0.2511574074074074],[30,76,0.0464326160815402],[30,77,0.0025974025974025974],[31,1,-0.16129032258064516],[31,2,-0.3401360544217687],[31,5,-0.11026615969581749],[31,9,-0.00047505938242280285],[31,11,-0.002074688796680498],[31,12,-0.0011750881316098707],[31,19,-0.0036900369003690036],[31,28,-0.030303030303030304],[31,29,-0.0035650623885918],[31,30,-0.0045351473922902496],[31,33,-0.004761904761904762],[31,35,-0.01486988847583643],[31,69,-0.016],[31,78,-0.2804532577903683],[32,0,0.11679492983250339],[32,4,0.016853932584269662],[32,5,0.053231939163498096],[32,6,0.011428571428571429],[32,7,0.0593607305936073],[32,8,0.022267206477732792],[32,9,0.09548693586698337],[32,10,0.09536423841059603],[32,11,0.0975103734439834],[32,12,0.01880141010575793],[32,14,0.016935483870967744],[32,15,0.15473032714412024],[32,16,0.015902140672782873],[32,19,0.0036900369003690036],[32,21,0.005925925925925926],[32,23,0.08522727272727272],[32,26,0.024390243902439025],[32,28,0.030303030303030304],[32,29,0.0071301247771836],[32,30,0.006802721088435374],[32,31,0.0027472527472527475],[32,33,0.02619047619047619],[32,34,0.02531645569620253],[32,38,0.09090909090909091],[32,70,0.0425531914893617],[32,71,0.019230769230769232],[32,73,0.11448598130841121],[32,76,0.0033975084937712344],[32,77,0.012987012987012988],[33,0,0.0018107741059302852],[33,7,0.0136986301369863],[33,10,0.006622516556291391],[33,12,0.12220916568742655],[33,13,0.002028397565922921],[33,14,0.004838709677419355],[33,15,0.0008841732979664014],[33,16,0.0006116207951070336],[33,21,0.1274074074074074],[33,22,0.009615384615384616],[33,23,0.002840909090909091],[33,24,0.0029895366218236174],[33,25,0.009615384615384616],[33,29,0.030303030303030304],[33,30,0.022675736961451247],[33,36,0.23300406740267288],[33,45,0.08433734939759036],[33,47,0.08064516129032258],[33,78,0.053824362606232294],[34,3,0.037037037037037035],[34,4,0.003745318352059925],[34,9,0.022327790973871733],[34,10,0.05033112582781457],[34,12,0.07755581668625147],[34,14,0.0024193548387096775],[34,15,0.030061892130857647],[34,16,0.014067278287461774],[34,18,0.006134969325153374],[34,21,0.04296296296296296],[34,22,0.038461538461538464],[34,23,0.008522727272727272],[34,26,0.016260162601626018],[34,27,0.0078125],[34,29,0.0053475935828877],[34,30,0.006802721088435374],[34,32,0.053726169844020795],[34,36,0.0005810575246949448],[34,41,0.02857142857142857],[34,43,0.032407407407407406],[34,46,0.030303030303030304],[34,55,0.05263157894736842],[34,61,0.1111111111111111],[34,70,0.0425531914893617],[34,73,0.12383177570093458],[35,0,-0.022181982797645994],[35,4,-0.013108614232209739],[35,5,-0.034220532319391636],[35,7,-0.00684931506849315],[35,8,-0.010121457489878543],[35,9,-0.00332541567695962],[35,10,-0.005298013245033113],[35,11,-0.06846473029045644],[35,12,-0.0011750881316098707],[35,14,-0.0008064516129032258],[35,15,-0.002652519893899204],[35,16,-0.005504587155963303],[35,19,-0.08487084870848709],[35,23,-0.011363636363636364],[35,28,-0.08417508417508418],[35,29,-0.0106951871657754],[35,30,-0.006802721088435374],[35,31,-0.16758241758241757],[35,32,-0.0017331022530329288],[35,33,-0.009523809523809525],[35,37,-0.13043478260869565],[35,38,-0.18181818181818182],[35,56,-0.34375],[35,71,-0.11538461538461539],[35,76,-0.007927519818799546],[35,77,-0.0025974025974025974],[36,2,-0.02040816326530612],[36,5,-0.0038022813688212928],[36,7,-0.04794520547945205],[36,12,-0.012925969447708578],[36,13,-0.018255578093306288],[36,16,-0.012844036697247707],[36,21,-0.1437037037037037],[36,24,-0.026905829596412557],[36,29,-0.1746880570409982],[36,30,-0.13378684807256236],[36,32,-0.0017331022530329288],[36,33,-0.030952380952380953],[36,34,-0.006329113924050633],[36,43,-0.018518518518518517],[36,48,-0.8850574712643678],[36,49,-0.9157894736842105],[36,51,-0.8695652173913043],[36,52,-0.7724137931034483],[36,53,-0.8235294117647058],[36,54,-0.856],[36,78,-0.32294617563739375],[37,0,0.038931643277501135],[37,4,0.04307116104868914],[37,5,0.030418250950570342],[37,6,0.02857142857142857],[37,7,0.01598173515981735],[37,8,0.10728744939271255],[37,9,0.009026128266033254],[37,10,0.006622516556291391],[37,11,0.024896265560165973],[37,14,0.0024193548387096775],[37,15,0.00618921308576481],[37,19,0.15867158671586715],[37,22,0.07692307692307693],[37,23,0.06818181818181818],[37,28,0.013468013468013467],[37,31,0.038461538461538464],[37,32,0.04852686308492201],[37,33,0.009523809523809525],[37,35,0.12639405204460966],[37,38,0.10909090909090909],[37,42,0.11016949152542373],[37,69,0.072],[37,70,0.11702127659574468],[37,71,0.21153846153846154],[37,73,0.016355140186915886],[37,74,0.0023148148148148147],[37,76,0.14156285390713477],[37,77,0.05714285714285714],[38,0,0.03757356269805342],[38,4,0.08239700374531835],[38,5,0.011406844106463879],[38,6,0.04285714285714286],[38,7,0.02511415525114155],[38,8,0.11133603238866396],[38,9,0.009501187648456057],[38,10,0.003973509933774834],[38,11,0.01037344398340249],[38,14,0.0008064516129032258],[38,15,0.007957559681697613],[38,19,0.17712177121771217],[38,22,0.125],[38,23,0.028409090909090908],[38,31,0.09065934065934066],[38,32,0.04852686308492201],[38,33,0.02142857142857143],[38,35,0.15985130111524162],[38,37,0.13043478260869565],[38,42,0.1271186440677966],[38,69,0.08],[38,70,0.031914893617021274],[38,71,0.25],[38,73,0.02336448598130841],[38,74,0.008101851851851851],[38,76,0.1664779161947905],[38,77,0.025974025974025976],[39,12,-0.01645123384253819],[39,13,-0.02434077079107505],[39,16,-0.031192660550458717],[39,18,-0.006134969325153374],[39,22,-0.009615384615384616],[39,24,-0.017937219730941704],[39,27,-0.1328125],[39,29,-0.0035650623885918],[39,30,-0.009070294784580499],[39,41,-0.2],[39,43,-0.009259259259259259],[39,44,-0.034482758620689655],[39,46,-0.2727272727272727],[39,55,-0.07894736842105263],[40,3,0.07407407407407407],[40,7,0.02511415525114155],[40,22,0.125],[40,26,0.08943089430894309],[40,33,0.002380952380952381],[40,50,0.125],[40,63,0.2],[40,66,0.2],[41,13,0.018255578093306288],[41,16,0.020795107033639144],[41,18,0.1656441717791411],[41,24,0.0029895366218236174],[41,27,0.2109375],[41,34,0.22151898734177214],[41,39,0.05454545454545454],[41,43,0.06018518518518518],[41,46,0.030303030303030304],[41,55,0.02631578947368421],[41,79,0.038461538461538464],[42,7,0.00684931506849315],[42,8,0.004048582995951417],[42,9,0.009976247030878859],[42,10,0.015894039735099338],[42,15,0.015030946065428824],[42,19,0.0036900369003690036],[42,23,0.017045454545454544],[42,28,0.003367003367003367],[42,31,0.0027472527472527475],[42,32,0.15424610051993068],[42,35,0.011152416356877323],[42,37,0.021739130434782608],[42,70,0.010638297872340425],[42,73,0.007009345794392523],[42,74,0.0011574074074074073],[42,76,0.02491506228765572],[42,77,0.02077922077922078],[43,2,-0.027210884353741496],[43,3,-0.07407407407407407],[43,5,-0.0076045627376425855],[43,12,-0.3008225616921269],[43,13,-0.008113590263691683],[43,16,-0.26605504587155965],[43,18,-0.049079754601226995],[43,22,-0.009615384615384616],[43,24,-0.16890881913303438],[43,25,-0.18269230769230768],[43,27,-0.015625],[43,29,-0.0106951871657754],[43,30,-0.0022675736961451248],[43,34,-0.006329113924050633],[43,41,-0.02857142857142857],[43,44,-0.034482758620689655],[43,46,-0.06060606060606061],[43,51,-0.07608695652173914],[43,52,-0.06896551724137931],[43,53,-0.0661764705882353],[43,54,-0.088],[43,55,-0.02631578947368421],[43,61,-0.05555555555555555],[43,78,-0.0084985835694051],[44,13,0.060851926977687626],[44,16,0.020795107033639144],[44,18,0.2147239263803681],[44,24,0.014947683109118086],[44,27,0.2109375],[44,34,0.15822784810126583],[44,39,0.12727272727272726],[44,43,0.06018518518518518],[44,53,0.07352941176470588],[44,55,0.10526315789473684],[45,0,0.027161611588954276],[45,3,0.037037037037037035],[45,5,0.053231939163498096],[45,6,0.06285714285714286],[45,7,0.0365296803652968],[45,9,0.004750593824228029],[45,10,0.005298013245033113],[45,11,0.002074688796680498],[45,14,0.020967741935483872],[45,15,0.032714412024756855],[45,17,0.034482758620689655],[45,23,0.002840909090909091],[45,24,0.0014947683109118087],[45,26,0.024390243902439025],[45,30,0.0022675736961451248],[45,31,0.01098901098901099],[45,33,0.07142857142857142],[45,35,0.0037174721189591076],[45,47,0.04838709677419355],[45,74,0.0787037037037037],[45,76,0.04756511891279728],[46,13,0.04665314401622718],[46,16,0.022629969418960245],[46,18,0.12883435582822086],[46,24,0.01195814648729447],[46,27,0.0859375],[46,29,0.0017825311942959],[46,34,0.14556962025316456],[46,39,0.03636363636363636],[46,41,0.08571428571428572],[46,43,0.08333333333333333],[46,55,0.18421052631578946],[46,67,0.75],[47,0,0.02127659574468085],[47,4,0.0018726591760299626],[47,5,0.03802281368821293],[47,6,0.02857142857142857],[47,7,0.0182648401826484],[47,9,0.006175771971496437],[47,10,0.0013245033112582781],[47,11,0.004149377593360996],[47,14,0.029838709677419355],[47,15,0.013262599469496022],[47,20,0.06993006993006994],[47,23,0.03409090909090909],[47,26,0.024390243902439025],[47,28,0.010101010101010102],[47,29,0.0017825311942959],[47,30,0.006802721088435374],[47,31,0.005494505494505495],[47,33,0.04523809523809524],[47,45,0.012048192771084338],[47,70,0.02127659574468085],[47,73,0.002336448598130841],[47,74,0.05787037037037037],[47,76,0.015855039637599093],[47,77,0.005194805194805195],[47,79,0.038461538461538464],[48,12,0.03407755581668625],[48,16,0.0006116207951070336],[48,21,0.08444444444444445],[48,24,0.016442451420029897],[48,25,0.009615384615384616],[48,29,0.0481283422459893],[48,30,0.015873015873015872],[48,36,0.06449738524113888],[48,49,0.08421052631578947],[48,78,0.019830028328611898],[49,7,0.00228310502283105],[49,12,0.04700352526439483],[49,16,0.0012232415902140672],[49,21,0.05925925925925926],[49,24,0.007473841554559043],[49,25,0.038461538461538464],[49,29,0.0481283422459893],[49,30,0.04081632653061224],[49,36,0.06449738524113888],[49,48,0.11494252873563218],[49,78,0.031161473087818695],[50,7,0.0136986301369863],[50,11,0.002074688796680498],[50,22,0.23076923076923078],[50,26,0.08943089430894309],[50,33,0.004761904761904762],[50,40,0.14285714285714285],[51,7,0.00228310502283105],[51,13,0.14807302231237324],[51,16,0.012232415902140673],[51,24,0.10911808669656203],[51,29,0.023172905525846704],[51,30,0.011337868480725623],[51,36,0.1115630447414294],[51,43,0.004629629629629629],[51,52,0.020689655172413793],[51,54,0.024],[52,13,0.0872210953346856],[52,16,0.009785932721712538],[52,24,0.10911808669656203],[52,29,0.008912655971479501],[52,30,0.006802721088435374],[52,36,0.08251016850668216],[52,43,0.004629629629629629],[52,51,0.03260869565217391],[52,53,0.029411764705882353],[52,54,0.016],[53,13,0.11764705882352941],[53,16,0.009785932721712538],[53,24,0.06278026905829596],[53,29,0.017825311942959002],[53,30,0.013605442176870748],[53,36,0.07495642068564788],[53,51,0.005434782608695652],[53,52,0.04827586206896552],[53,54,0.016],[54,13,0.15212981744421908],[54,16,0.012844036697247707],[54,24,0.08968609865470852],[54,29,0.017825311942959002],[54,30,0.0045351473922902496],[54,36,0.07205113306217316],[54,51,0.016304347826086956],[54,52,0.027586206896551724],[54,53,0.007352941176470588],[55,13,0.02231237322515213],[55,16,0.021406727828746176],[55,18,0.17177914110429449],[55,24,0.007473841554559043],[55,27,0.125],[55,34,0.17088607594936708],[55,39,0.07272727272727272],[55,41,0.11428571428571428],[55,43,0.037037037037037035],[55,44,0.06896551724137931],[55,46,0.12121212121212122],[56,0,0.023087369850611137],[56,4,0.0056179775280898875],[56,5,0.12927756653992395],[56,6,0.008571428571428572],[56,7,0.02054794520547945],[56,8,0.03643724696356275],[56,9,0.007125890736342043],[56,10,0.005298013245033113],[56,11,0.13900414937759337],[56,14,0.020967741935483872],[56,15,0.0035366931918656055],[56,19,0.18081180811808117],[56,23,0.04261363636363636],[56,28,0.030303030303030304],[56,31,0.0027472527472527475],[56,32,0.03466204506065858],[56,33,0.01904761904761905],[56,35,0.11895910780669144],[56,42,0.211864406779661],[56,69,0.304],[56,70,0.2978723404255319],[56,73,0.03271028037383177],[56,74,0.024305555555555556],[56,76,0.16761041902604756],[56,77,0.046753246753246755],[57,16,0.003669724770642202],[57,24,0.0014947683109118087],[57,25,0.28846153846153844],[57,62,0.8],[57,78,0.10764872521246459],[58,1,0.2661290322580645],[58,22,0.009615384615384616],[58,33,0.002380952380952381],[59,13,0.004056795131845842],[59,16,0.014678899082568808],[59,18,0.006134969325153374],[59,29,0.0017825311942959],[59,34,0.05063291139240506],[59,39,0.16363636363636364],[59,61,0.2777777777777778],[60,3,0.037037037037037035],[60,29,0.0285204991087344],[60,30,0.045351473922902494],[60,34,0.02531645569620253],[60,39,0.12727272727272726],[60,52,0.006896551724137931],[60,61,0.5],[61,13,0.010141987829614604],[61,16,0.01529051987767584],[61,18,0.012269938650306749],[61,30,0.0022675736961451248],[61,34,0.02531645569620253],[61,39,0.34545454545454546],[61,46,0.030303030303030304],[61,52,0.05517241379310345],[61,59,0.6],[61,60,1],[62,3,0.037037037037037035],[62,16,0.004281345565749235],[62,24,0.004484304932735426],[62,25,0.34615384615384615],[62,34,0.006329113924050633],[62,57,0.8260869565217391],[62,78,0.06232294617563739],[63,7,0.0091324200913242],[63,17,0.06896551724137931],[63,22,0.10576923076923077],[63,26,0.15447154471544716],[63,33,0.004761904761904762],[63,50,0.125],[63,72,0.5],[64,2,0.19047619047619047],[64,29,0.0017825311942959],[65,5,0.0038022813688212928],[65,10,0.007947019867549669],[65,20,0.3146853146853147],[65,28,0.020202020202020204],[65,33,0.002380952380952381],[65,75,0.8571428571428571],[66,7,0.0045662100456621],[66,10,0.03708609271523179],[66,22,0.028846153846153848],[66,33,0.007142857142857143],[66,40,0.14285714285714285],[66,72,0.5],[67,2,0.19727891156462585],[67,18,0.012269938650306749],[67,46,0.06060606060606061],[67,64,1],[68,1,0.2661290322580645],[68,33,0.009523809523809525],[69,0,-0.001358080579447714],[69,1,-0.024193548387096774],[69,2,-0.06802721088435375],[69,4,-0.0018726591760299626],[69,5,-0.09125475285171103],[69,6,-0.017142857142857144],[69,7,-0.00228310502283105],[69,8,-0.010121457489878543],[69,9,-0.00047505938242280285],[69,10,-0.0026490066225165563],[69,11,-0.026970954356846474],[69,14,-0.0008064516129032258],[69,15,-0.0017683465959328027],[69,19,-0.06642066420664207],[69,23,-0.008522727272727272],[69,26,-0.008130081300813009],[69,27,-0.015625],[69,28,-0.006734006734006734],[69,30,-0.0022675736961451248],[69,31,-0.0027472527472527475],[69,32,-0.008665511265164644],[69,35,-0.0037174721189591076],[69,56,-0.03125],[69,73,-0.009345794392523364],[69,76,-0.0011325028312570782],[69,77,-0.14025974025974025],[70,0,-0.01810774105930285],[70,4,-0.0056179775280898875],[70,6,-0.014285714285714285],[70,7,-0.01141552511415525],[70,8,-0.012145748987854251],[70,9,-0.00047505938242280285],[70,10,-0.0013245033112582781],[70,11,-0.01867219917012448],[70,12,-0.0011750881316098707],[70,14,-0.0008064516129032258],[70,15,-0.0017683465959328027],[70,17,-0.034482758620689655],[70,19,-0.01845018450184502],[70,20,-0.006993006993006993],[70,22,-0.009615384615384616],[70,23,-0.008522727272727272],[70,27,-0.0078125],[70,28,-0.003367003367003367],[70,29,-0.008912655971479501],[70,32,-0.05545927209705372],[70,35,-0.0037174721189591076],[70,37,-0.13043478260869565],[70,38,-0.01818181818181818],[70,42,-0.03389830508474576],[70,56,-0.15625],[70,71,-0.07692307692307693],[70,73,-0.016355140186915886],[70,74,-0.0011574074074074073],[70,76,-0.014722536806342015],[70,77,-0.005194805194805195],[70,79,-0.038461538461538464],[71,0,0.02444545043005885],[71,4,0.07865168539325842],[71,5,0.019011406844106463],[71,6,0.04857142857142857],[71,7,0.00228310502283105],[71,8,0.10526315789473684],[71,9,0.012351543942992874],[71,10,0.031788079470198675],[71,11,0.004149377593360996],[71,14,0.0016129032258064516],[71,15,0.00618921308576481],[71,19,0.15498154981549817],[71,22,0.04807692307692308],[71,23,0.04261363636363636],[71,31,0.09615384615384616],[71,32,0.05199306759098787],[71,33,0.04285714285714286],[71,35,0.20074349442379183],[71,37,0.30434782608695654],[71,38,0.16363636363636364],[71,42,0.22033898305084745],[71,69,0.168],[71,70,0.09574468085106383],[71,73,0.04439252336448598],[71,74,0.006944444444444444],[71,76,0.17893544733861835],[71,77,0.06493506493506493],[72,7,0.00228310502283105],[72,10,0.030463576158940398],[72,22,0.019230769230769232],[72,33,0.002380952380952381],[72,66,0.6],[73,4,0.0056179775280898875],[73,6,0.002857142857142857],[73,8,0.0020242914979757085],[73,9,0.015676959619952493],[73,10,0.09801324503311258],[73,11,0.006224066390041493],[73,12,0.0023501762632197414],[73,13,0.002028397565922921],[73,14,0.0008064516129032258],[73,16,0.0024464831804281344],[73,17,0.10344827586206896],[73,23,0.008522727272727272],[73,26,0.016260162601626018],[73,32,0.005199306759098787],[73,76,0.0033975084937712344],[73,79,0.038461538461538464],[74,0,-0.0018107741059302852],[74,4,-0.00749063670411985],[74,5,-0.030418250950570342],[74,6,-0.011428571428571429],[74,7,-0.14840182648401826],[74,9,-0.004275534441805225],[74,10,-0.02384105960264901],[74,11,-0.008298755186721992],[74,14,-0.04435483870967742],[74,15,-0.0008841732979664014],[74,17,-0.034482758620689655],[74,19,-0.01845018450184502],[74,23,-0.002840909090909091],[74,24,-0.013452914798206279],[74,26,-0.024390243902439025],[74,28,-0.32996632996632996],[74,29,-0.016042780748663103],[74,30,-0.009070294784580499],[74,31,-0.008241758241758242],[74,32,-0.0017331022530329288],[74,33,-0.1523809523809524],[74,35,-0.0037174721189591076],[74,38,-0.12727272727272726],[74,45,-0.8192771084337349],[74,47,-0.6774193548387096],[74,56,-0.34375],[74,70,-0.02127659574468085],[74,71,-0.11538461538461539],[74,73,-0.002336448598130841],[74,76,-0.006795016987542469],[74,79,-0.038461538461538464],[75,5,0.0038022813688212928],[75,10,0.0013245033112582781],[75,11,0.058091286307053944],[75,20,0.3146853146853147],[75,28,0.10101010101010101],[75,65,1],[76,0,0.0009053870529651426],[76,4,0.4157303370786517],[76,5,0.0038022813688212928],[76,6,0.1657142857142857],[76,7,0.09360730593607305],[76,8,0.03441295546558704],[76,9,0.010926365795724466],[76,10,0.1403973509933775],[76,12,0.0011750881316098707],[76,14,0.03306451612903226],[76,15,0.022988505747126436],[76,21,0.01037037037037037],[76,23,0.17329545454545456],[76,26,0.008130081300813009],[76,29,0.0017825311942959],[76,30,0.0045351473922902496],[76,32,0.08838821490467938],[76,33,0.02857142857142857],[76,35,0.0037174721189591076],[76,38,0.01818181818181818],[76,42,0.06779661016949153],[76,70,0.010638297872340425],[76,71,0.019230769230769232],[76,73,0.07710280373831775],[76,74,0.0011574074074074073],[76,77,0.12727272727272726],[77,0,0.04436396559529199],[77,4,0.052434456928838954],[77,6,0.011428571428571429],[77,8,0.03643724696356275],[77,9,0.029453681710213776],[77,10,0.017218543046357615],[77,11,0.01037344398340249],[77,14,0.0024193548387096775],[77,15,0.010610079575596816],[77,23,0.017045454545454544],[77,26,0.024390243902439025],[77,31,0.0027472527472527475],[77,32,0.022530329289428077],[77,35,0.007434944237918215],[77,37,0.043478260869565216],[77,38,0.01818181818181818],[77,47,0.016129032258064516],[77,73,0.035046728971962614],[77,76,0.004530011325028313],[78,2,-0.05442176870748299],[78,3,-0.037037037037037035],[78,12,-0.01762632197414806],[78,13,-0.008113590263691683],[78,16,-0.052599388379204894],[78,21,-0.0044444444444444444],[78,25,-0.038461538461538464],[78,29,-0.0053475935828877],[78,30,-0.011337868480725623],[78,31,-0.005494505494505495],[78,36,-0.0011621150493898896],[78,57,-0.17391304347826086],[78,62,-0.13333333333333333],[79,1,0.016129032258064516],[79,3,0.3333333333333333],[79,4,0.003745318352059925],[79,5,0.0038022813688212928],[79,6,0.005714285714285714],[79,7,0.00228310502283105],[79,9,0.00047505938242280285],[79,11,0.004149377593360996],[79,12,0.0011750881316098707],[79,13,0.006085192697768763],[79,14,0.0008064516129032258],[79,15,0.004420866489832007],[79,17,0.2413793103448276],[79,18,0.06748466257668712],[79,20,0.006993006993006993],[79,21,0.002962962962962963],[79,22,0.009615384615384616],[79,23,0.002840909090909091],[79,25,0.019230769230769232],[79,26,0.016260162601626018],[79,27,0.015625],[79,28,0.006734006734006734],[79,30,0.006802721088435374],[79,33,0.004761904761904762],[79,34,0.012658227848101266],[79,39,0.01818181818181818],[79,43,0.013888888888888888],[79,67,0.25],[79,69,0.032],[79,70,0.010638297872340425],[79,73,0.004672897196261682],[79,74,0.0023148148148148147]];
  const CHAMP = [0.27026501135995196,-0.8686498847433797,0.43115327058839686,-0.054975204723498455,-0.39635464266262493,1.4806707955367722,-0.08764611512470966,0.2552791259736091,-0.6996869060966276,-0.15867412338234374,-0.9074845935454825,2.264620077511454,-0.30234356881630675,-1.1296992992459174,0.29245946015536023,0.7209243931822782,0.047970662313760445,0.4940817257964957,-0.2744050207256208,-0.6693714282118847,1.027759675708789,-2.5114241801944965,-1.3470590239474074,-0.44632485458567395,0.19363165069639596,0.28667477524269436,0.32986022077866156,0.8355903225611383,0.1637249951661237,0.8572086109259589,0.4666529457061789,0.4222021347667895,1.4088875038361044,-0.344372801231303,0.5582212651035446,-0.7606036658601446,1.3056524428953138,0.2644161564788285,-0.23277206821025595,-0.8224937895335249,-0.046751197320439156,1.0597872533844024,0.27146213627898214,-0.3155067504688409,0.03186893133247016,-0.015967622197108747,0.4981517696416562,0.40436165300715676,-0.31380175709918745,-1.7795183860205301,0.49691547514169293,-0.3431088027061183,0.033128182344154766,0.4018767341184368,0.18555414664080566,0.33453564732007235,-0.36478673069669315,0.6913600932316959,0.2137404187951162,-0.5853815687329929,0.009527632439372047,-0.6117759945199471,0.19876795697401206,0.251881112398295,-0.9207771633787905,0.726481019270848,0.8785926878257068,0.7543442139462714,0.3281287621508374,0.7472316709841896,-0.5672040443111352,-0.023555692685332835,0.8221727662914118,0.6661488847339524,-0.04566939351827414,0.46098317728884375,-0.5031725827998585,-0.1548989696060498,-0.5579959945738575,0.0879316175986335,-0.6129029555584805,1.7372565947194667,-0.13811589468540644,-0.024075990026378336,-0.0862039237239775,0.5035709607292034,-0.5818250658069348,0.5656118796730881,0.3845959401320729,-0.13647133410155732,-0.9437682902010276,-0.6371412587793888,0.12121093833932217,-0.3946497850235151,0.2593764931233466,0.9854090382735206,0.0888064797323523,0.6716393644487726,-0.6307098261334554,-0.35893146570624007,-1.4234921756536083,0.10067839627387198,-0.028924947900914447,0.31086205695425617,0.21006875292039406,2.0140590010765727,0.04516422568579625,0.5421100752469938,-0.2838252381036904,-0.3094839628684824,-0.17219813238608148,-0.08901094423199038,-0.034715113486827306,0.11178393668927103,-0.3680354006061564,-0.6380503989655488,1.4964942794781972,0.08179017299355665,0.398338653383447,-0.5171051615108442,-0.8185303276565932,-0.9825905740362344,-0.950155593446762,0.9916035671442833,-0.27427725168298295,0.9251356495648343,0.08702773782540411,-0.7536497871629106,-0.07408700980148757,0.507645643608996,0.0051684523118257775,-0.371942538216535,-0.1483862878969035,-0.3683284046136815,0.6940126500059615,0.2851150377171311,0.6034040829710301,-0.6920423752105981,-0.20224191977061065,-0.6793562953479757,-0.01936138613904877,0.10405473295562606,-0.403333767579978,-0.21889243521982799,1.9168371371486452,-0.7593982229939527,0.09442042680723642,0.13970771123978365,0.722340947455645,-0.42632904596349497,-0.1319289018471972,0.11073097165525739,1.1038582530143934,0.8162349046630153,-0.6669388026694225,0.4820440128054699,-0.6905047595062983,0.5405183761671207,-0.38025117427366073,-0.09492362536950105,-0.2592391933493623,-0.22551145598440664,-0.4617833630532311,-0.415175212625531,0.030430100427053568,0.2905274354881341,1.5935740788272346,-0.3956636717088996,0.43839387809425956,-0.02852956930280104,-0.32725034875754766,0.3612964867944773,-0.011142305509040409,-0.25173652773021415,-0.13206969590789047,1.9376741077346544,0.8149396181137204,0.3339796009712607,0.2695025871087783,0.4415790023474013,0.46306525113761765,-0.048269761722848054,-0.1876414020191125,-0.9733302154208296,-0.3044057364691056,0.4425156303768553,0.09514452204633972,0.24162736668244264,0.35623903323218986,0.12288650964990429,-1.115888566527024,1.9857479866792787,0.6204521936844813,0.2863953756420015,-0.11251478546762625,0.5010206530598994,0.36175483967344446,-0.11670018145615722,0.8835352884714716,-0.41665466742562896,0.05321603522371953,-0.5135359936967514,-0.6897897796311621,-0.11537852312850283,0.37517114609484453,-0.8160463110132014,-0.3637681238848802,-1.0078614361868383,-0.222587812304583,0.16082497147271538,-0.5856674379390527,-1.3444581231846278,-1.0429696577771566,0.4565603829394713,0.574872899842491,-0.4096671420033717,-0.6160886446345655,0.680261908938295,-1.7279167810716005,-0.36864658649779636,0.5458023534614146,-0.7319191534659995,-0.5639190398267088,-0.0849537860035191,-0.06515432577174818,-0.5985165660995977,-1.2669241342899693,0.23670568056304664,-0.1655855765120194,0.02037364855903872,-1.039531647161369,0.36021109246903843,0.46728331202661855,0.05239721524282403,-0.5351810947348803,0.7899735170014456,-0.12510338761684392,-0.30591875748583963,0.23049237792464358,0.6847225541764976,-0.7957417493991342,-0.793016301931724,-0.2718656800861343,-0.17721749045441984,-0.5959285328057762,0.4347212443577758,-0.66787839078769,0.3295289576946011,-0.5613346269020594,0.2302340112141201,-0.05318121898478065,0.1708951330844786,-0.4001229800525097,0.06738153144003263,-0.04713483351424623,0.6278179016502892,0.00018957240127792652,0.5509482789399255,1.3468476828639837,-0.16339553176784352,0.06684459958505774,0.5808250549298786,0.33696905668449906,0.07178611366254173,-0.17832751822413118,0.3055402931787797,-0.2163641306506422,2.217902837558915,-0.36399371132687763];
  const N_IN = 16, N_HID = 12, N_OUT = 5;
  const ACTIONS = ["NOOP","LEFT","RIGHT","JUMP","DUCK"];
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
    positions: [[58238,22234,36276],[56562,17820,34706],[39330,19195,35528],[34200,17553,36204],[62869,11945,19668],[63384,22340,35354],[73058,11486,25246],[73609,20836,22268],[58903,20337,35171],[59023,21254,36260],[59209,19523,35768],[59816,25251,37404],[34618,24870,36898],[29580,22155,35748],[51581,47658,27161],[61547,23883,37106],[38498,23136,36668],[59220,18642,36722],[23053,14740,25821],[53694,16558,30964],[58758,21229,37805],[43712,47100,22322],[73802,22777,22759],[60475,25706,37951],[37723,24091,37716],[37169,19527,37740],[61388,21246,18279],[22906,14718,24916],[71370,19818,20043],[24127,28055,21915],[23733,26445,22130],[61953,21741,17634],[61536,30488,36680],[73404,23146,21446],[23336,24808,23814],[61864,23796,17365],[36615,30011,21067],[66418,32199,28481],[66256,32511,28966],[29030,19295,35901],[65416,37646,26902],[29040,20660,36692],[67416,34504,23158],[24679,16248,27080],[26768,18682,36400],[71862,17860,31026],[29510,22756,35386],[65771,24959,36036],[24607,18794,34051],[26782,19748,34550],[62960,39573,33949],[31903,35770,28609],[29092,32636,27746],[30009,34532,26146],[30621,34477,27774],[22906,17418,35530],[66089,30771,28818],[23806,18714,33996],[65394,34730,28946],[31264,25556,36184],[31989,39610,28284],[30490,24454,36662],[24764,19304,34141],[63088,38828,32610],[32740,37356,29602],[72478,17044,32294],[66196,22004,37015],[31741,38012,28573],[66856,35795,27429],[61166,23026,16634],[65857,20818,16698],[67389,32279,27764],[66348,22968,37112],[73314,20908,20522],[60499,27648,19538],[72280,17378,32522],[57228,19519,38264],[54729,34030,17250],[24165,21630,21692],[61126,16134,36332]], roles: ["output","output","output","output","interneuron","interneuron","interneuron","interneuron","output","output","output","output","interneuron","interneuron","interneuron","interneuron","output","output","interneuron","output","output","output","interneuron","interneuron","interneuron","output","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","interneuron","input","input","interneuron","input","input","interneuron","interneuron","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","input","interneuron","interneuron","input","input","interneuron","interneuron","input","output","interneuron","interneuron","output"],
    edges: [[0,4],[0,6],[0,8],[0,9],[0,11],[0,12],[0,14],[0,15],[0,23],[0,26],[0,29],[0,30],[0,32],[0,35],[0,42],[0,45],[0,56],[0,70],[0,76],[0,77],[1,8],[1,20],[1,21],[1,31],[2,12],[2,16],[2,21],[2,43],[3,4],[3,7],[3,8],[3,9],[3,10],[3,11],[3,12],[3,13],[3,14],[3,15],[3,17],[3,18],[3,20],[3,22],[3,24],[3,25],[3,26],[3,27],[3,29],[3,30],[3,32],[3,33],[3,34],[3,36],[3,39],[3,40],[3,42],[3,43],[3,50],[3,62],[3,70],[3,74],[3,78],[3,79],[4,0],[4,1],[4,5],[4,6],[4,7],[4,8],[4,9],[4,10],[4,11],[4,14],[4,15],[4,17],[4,19],[4,20],[4,23],[4,26],[4,29],[4,30],[4,31],[4,32],[4,33],[4,35],[4,37],[4,38],[4,42],[4,69],[4,70],[4,71],[4,73],[4,74],[4,76],[4,77],[5,2],[5,13],[5,16],[5,17],[5,24],[5,28],[5,29],[5,30],[5,31],[5,33],[5,43],[5,73],[5,78],[6,0],[6,1],[6,4],[6,7],[6,8],[6,9],[6,10],[6,11],[6,14],[6,15],[6,17],[6,19],[6,20],[6,23],[6,26],[6,28],[6,29],[6,31],[6,33],[6,34],[6,37],[6,38],[6,45],[6,47],[6,71],[6,73],[6,74],[6,76],[6,77],[7,0],[7,6],[7,8],[7,9],[7,11],[7,12],[7,14],[7,15],[7,16],[7,21],[7,23],[7,24],[7,26],[7,28],[7,29],[7,30],[7,31],[7,33],[7,36],[7,37],[7,76],[7,78],[8,0],[8,1],[8,4],[8,9],[8,10],[8,11],[8,14],[8,15],[8,21],[8,76],[8,77],[9,0],[9,4],[9,7],[9,8],[9,12],[9,14],[9,15],[9,21],[9,29],[9,30],[9,76],[9,77],[10,8],[10,9],[10,14],[10,15],[10,16],[10,20],[10,21],[10,76],[11,0],[11,4],[11,7],[11,8],[11,9],[11,14],[11,17],[11,21],[11,28],[11,32],[11,35],[11,42],[11,69],[11,74],[11,79],[12,0],[12,7],[12,8],[12,9],[12,14],[12,15],[12,16],[12,18],[12,21],[12,24],[12,29],[12,30],[12,32],[12,33],[12,34],[12,43],[12,76],[13,2],[13,3],[13,5],[13,7],[13,12],[13,16],[13,18],[13,24],[13,25],[13,27],[13,29],[13,30],[13,36],[13,39],[13,43],[13,44],[13,46],[13,51],[13,53],[13,54],[13,57],[13,59],[13,78],[13,79],[14,0],[14,4],[14,6],[14,8],[14,9],[14,10],[14,11],[14,23],[14,29],[14,31],[14,32],[14,35],[14,69],[14,73],[14,74],[14,76],[14,77],[15,0],[15,3],[15,4],[15,6],[15,7],[15,8],[15,9],[15,11],[15,12],[15,14],[15,20],[15,21],[15,23],[15,26],[15,28],[15,29],[15,30],[15,32],[15,33],[15,45],[15,47],[15,56],[15,69],[15,70],[15,73],[15,76],[15,77],[16,10],[16,11],[16,12],[16,14],[16,21],[16,24],[16,25],[16,27],[16,43],[16,76],[17,1],[17,4],[17,6],[17,10],[17,15],[17,26],[17,28],[17,73],[17,76],[18,2],[18,3],[18,12],[18,13],[18,16],[18,21],[18,22],[18,24],[18,25],[18,27],[18,29],[18,30],[18,34],[18,41],[18,43],[18,44],[18,46],[18,55],[18,59],[18,61],[19,5],[19,8],[19,10],[19,11],[19,69],[20,1],[20,3],[20,10],[20,15],[20,17],[21,1],[21,7],[21,8],[21,11],[21,12],[21,30],[21,36],[21,76],[22,3],[22,9],[22,10],[22,11],[22,12],[22,15],[22,16],[22,17],[22,18],[22,23],[22,30],[22,32],[22,34],[22,35],[22,38],[22,39],[22,40],[22,43],[22,50],[22,58],[22,63],[22,66],[22,69],[22,70],[22,73],[22,75],[22,79],[23,0],[23,4],[23,6],[23,7],[23,8],[23,9],[23,10],[23,11],[23,12],[23,14],[23,15],[23,16],[23,20],[23,21],[23,22],[23,26],[23,28],[23,29],[23,30],[23,31],[23,32],[23,33],[23,35],[23,36],[23,37],[23,38],[23,43],[23,45],[23,47],[23,56],[23,69],[23,70],[23,71],[23,73],[23,76],[23,77],[23,78],[23,79],[24,5],[24,6],[24,7],[24,10],[24,12],[24,13],[24,16],[24,18],[24,26],[24,28],[24,30],[24,31],[24,32],[24,33],[24,36],[24,43],[24,69],[24,70],[24,73],[24,74],[24,76],[24,78],[25,16],[25,79],[26,0],[26,4],[26,5],[26,6],[26,7],[26,8],[26,9],[26,10],[26,11],[26,14],[26,15],[26,20],[26,23],[26,24],[26,28],[26,30],[26,32],[26,33],[26,34],[26,35],[26,40],[26,50],[26,63],[26,73],[26,74],[26,76],[26,79],[27,12],[27,13],[27,16],[27,18],[27,21],[27,22],[27,24],[27,29],[27,30],[27,34],[27,41],[27,43],[27,44],[27,46],[27,55],[27,59],[27,69],[27,73],[27,79],[28,0],[28,1],[28,4],[28,5],[28,7],[28,8],[28,9],[28,10],[28,11],[28,14],[28,15],[28,19],[28,20],[28,23],[28,24],[28,26],[28,31],[28,32],[28,33],[28,35],[28,42],[28,69],[28,70],[28,76],[28,77],[28,79],[29,0],[29,4],[29,6],[29,7],[29,9],[29,10],[29,11],[29,14],[29,15],[29,20],[29,23],[29,24],[29,26],[29,30],[29,31],[29,32],[29,33],[29,34],[29,35],[29,36],[29,42],[29,47],[29,69],[29,70],[29,73],[29,74],[29,76],[29,77],[29,78],[30,0],[30,4],[30,6],[30,7],[30,9],[30,11],[30,12],[30,14],[30,15],[30,19],[30,20],[30,21],[30,23],[30,26],[30,28],[30,29],[30,31],[30,32],[30,33],[30,35],[30,36],[30,42],[30,45],[30,47],[30,69],[30,70],[30,73],[30,74],[30,76],[30,77],[31,1],[31,2],[31,5],[31,9],[31,11],[31,12],[31,19],[31,28],[31,29],[31,30],[31,33],[31,35],[31,69],[31,78],[32,0],[32,4],[32,5],[32,6],[32,7],[32,8],[32,9],[32,10],[32,11],[32,12],[32,14],[32,15],[32,16],[32,19],[32,21],[32,23],[32,26],[32,28],[32,29],[32,30],[32,31],[32,33],[32,34],[32,38],[32,70],[32,71],[32,73],[32,76],[32,77],[33,0],[33,7],[33,10],[33,12],[33,13],[33,14],[33,15],[33,16],[33,21],[33,22],[33,23],[33,24],[33,25],[33,29],[33,30],[33,36],[33,45],[33,47],[33,78],[34,3],[34,4],[34,9],[34,10],[34,12],[34,14],[34,15],[34,16],[34,18],[34,21],[34,22],[34,23],[34,26],[34,27],[34,29],[34,30],[34,32],[34,36],[34,41],[34,43],[34,46],[34,55],[34,61],[34,70],[34,73],[35,0],[35,4],[35,5],[35,7],[35,8],[35,9],[35,10],[35,11],[35,12],[35,14],[35,15],[35,16],[35,19],[35,23],[35,28],[35,29],[35,30],[35,31],[35,32],[35,33],[35,37],[35,38],[35,56],[35,71],[35,76],[35,77],[36,2],[36,5],[36,7],[36,12],[36,13],[36,16],[36,21],[36,24],[36,29],[36,30],[36,32],[36,33],[36,34],[36,43],[36,48],[36,49],[36,51],[36,52],[36,53],[36,54],[36,78],[37,0],[37,4],[37,5],[37,6],[37,7],[37,8],[37,9],[37,10],[37,11],[37,14],[37,15],[37,19],[37,22],[37,23],[37,28],[37,31],[37,32],[37,33],[37,35],[37,38],[37,42],[37,69],[37,70],[37,71],[37,73],[37,74],[37,76],[37,77],[38,0],[38,4],[38,5],[38,6],[38,7],[38,8],[38,9],[38,10],[38,11],[38,14],[38,15],[38,19],[38,22],[38,23],[38,31],[38,32],[38,33],[38,35],[38,37],[38,42],[38,69],[38,70],[38,71],[38,73],[38,74],[38,76],[38,77],[39,12],[39,13],[39,16],[39,18],[39,22],[39,24],[39,27],[39,29],[39,30],[39,41],[39,43],[39,44],[39,46],[39,55],[40,3],[40,7],[40,22],[40,26],[40,33],[40,50],[40,63],[40,66],[41,13],[41,16],[41,18],[41,24],[41,27],[41,34],[41,39],[41,43],[41,46],[41,55],[41,79],[42,7],[42,8],[42,9],[42,10],[42,15],[42,19],[42,23],[42,28],[42,31],[42,32],[42,35],[42,37],[42,70],[42,73],[42,74],[42,76],[42,77],[43,2],[43,3],[43,5],[43,12],[43,13],[43,16],[43,18],[43,22],[43,24],[43,25],[43,27],[43,29],[43,30],[43,34],[43,41],[43,44],[43,46],[43,51],[43,52],[43,53],[43,54],[43,55],[43,61],[43,78],[44,13],[44,16],[44,18],[44,24],[44,27],[44,34],[44,39],[44,43],[44,53],[44,55],[45,0],[45,3],[45,5],[45,6],[45,7],[45,9],[45,10],[45,11],[45,14],[45,15],[45,17],[45,23],[45,24],[45,26],[45,30],[45,31],[45,33],[45,35],[45,47],[45,74],[45,76],[46,13],[46,16],[46,18],[46,24],[46,27],[46,29],[46,34],[46,39],[46,41],[46,43],[46,55],[46,67],[47,0],[47,4],[47,5],[47,6],[47,7],[47,9],[47,10],[47,11],[47,14],[47,15],[47,20],[47,23],[47,26],[47,28],[47,29],[47,30],[47,31],[47,33],[47,45],[47,70],[47,73],[47,74],[47,76],[47,77],[47,79],[48,12],[48,16],[48,21],[48,24],[48,25],[48,29],[48,30],[48,36],[48,49],[48,78],[49,7],[49,12],[49,16],[49,21],[49,24],[49,25],[49,29],[49,30],[49,36],[49,48],[49,78],[50,7],[50,11],[50,22],[50,26],[50,33],[50,40],[51,7],[51,13],[51,16],[51,24],[51,29],[51,30],[51,36],[51,43],[51,52],[51,54],[52,13],[52,16],[52,24],[52,29],[52,30],[52,36],[52,43],[52,51],[52,53],[52,54],[53,13],[53,16],[53,24],[53,29],[53,30],[53,36],[53,51],[53,52],[53,54],[54,13],[54,16],[54,24],[54,29],[54,30],[54,36],[54,51],[54,52],[54,53],[55,13],[55,16],[55,18],[55,24],[55,27],[55,34],[55,39],[55,41],[55,43],[55,44],[55,46],[56,0],[56,4],[56,5],[56,6],[56,7],[56,8],[56,9],[56,10],[56,11],[56,14],[56,15],[56,19],[56,23],[56,28],[56,31],[56,32],[56,33],[56,35],[56,42],[56,69],[56,70],[56,73],[56,74],[56,76],[56,77],[57,16],[57,24],[57,25],[57,62],[57,78],[58,1],[58,22],[58,33],[59,13],[59,16],[59,18],[59,29],[59,34],[59,39],[59,61],[60,3],[60,29],[60,30],[60,34],[60,39],[60,52],[60,61],[61,13],[61,16],[61,18],[61,30],[61,34],[61,39],[61,46],[61,52],[61,59],[61,60],[62,3],[62,16],[62,24],[62,25],[62,34],[62,57],[62,78],[63,7],[63,17],[63,22],[63,26],[63,33],[63,50],[63,72],[64,2],[64,29],[65,5],[65,10],[65,20],[65,28],[65,33],[65,75],[66,7],[66,10],[66,22],[66,33],[66,40],[66,72],[67,2],[67,18],[67,46],[67,64],[68,1],[68,33],[69,0],[69,1],[69,2],[69,4],[69,5],[69,6],[69,7],[69,8],[69,9],[69,10],[69,11],[69,14],[69,15],[69,19],[69,23],[69,26],[69,27],[69,28],[69,30],[69,31],[69,32],[69,35],[69,56],[69,73],[69,76],[69,77],[70,0],[70,4],[70,6],[70,7],[70,8],[70,9],[70,10],[70,11],[70,12],[70,14],[70,15],[70,17],[70,19],[70,20],[70,22],[70,23],[70,27],[70,28],[70,29],[70,32],[70,35],[70,37],[70,38],[70,42],[70,56],[70,71],[70,73],[70,74],[70,76],[70,77],[70,79],[71,0],[71,4],[71,5],[71,6],[71,7],[71,8],[71,9],[71,10],[71,11],[71,14],[71,15],[71,19],[71,22],[71,23],[71,31],[71,32],[71,33],[71,35],[71,37],[71,38],[71,42],[71,69],[71,70],[71,73],[71,74],[71,76],[71,77],[72,7],[72,10],[72,22],[72,33],[72,66],[73,4],[73,6],[73,8],[73,9],[73,10],[73,11],[73,12],[73,13],[73,14],[73,16],[73,17],[73,23],[73,26],[73,32],[73,76],[73,79],[74,0],[74,4],[74,5],[74,6],[74,7],[74,9],[74,10],[74,11],[74,14],[74,15],[74,17],[74,19],[74,23],[74,24],[74,26],[74,28],[74,29],[74,30],[74,31],[74,32],[74,33],[74,35],[74,38],[74,45],[74,47],[74,56],[74,70],[74,71],[74,73],[74,76],[74,79],[75,5],[75,10],[75,11],[75,20],[75,28],[75,65],[76,0],[76,4],[76,5],[76,6],[76,7],[76,8],[76,9],[76,10],[76,12],[76,14],[76,15],[76,21],[76,23],[76,26],[76,29],[76,30],[76,32],[76,33],[76,35],[76,38],[76,42],[76,70],[76,71],[76,73],[76,74],[76,77],[77,0],[77,4],[77,6],[77,8],[77,9],[77,10],[77,11],[77,14],[77,15],[77,23],[77,26],[77,31],[77,32],[77,35],[77,37],[77,38],[77,47],[77,73],[77,76],[78,2],[78,3],[78,12],[78,13],[78,16],[78,21],[78,25],[78,29],[78,30],[78,31],[78,36],[78,57],[78,62],[79,1],[79,3],[79,4],[79,5],[79,6],[79,7],[79,9],[79,11],[79,12],[79,13],[79,14],[79,15],[79,17],[79,18],[79,20],[79,21],[79,22],[79,23],[79,25],[79,26],[79,27],[79,28],[79,30],[79,33],[79,34],[79,39],[79,43],[79,67],[79,69],[79,70],[79,73],[79,74]], actions: ["NOOP","LEFT","RIGHT","JUMP","DUCK"],
    inputLabels: ["DNp04","DNp01","DNp35","DNp27","DNp09","DNp09","DNp27","DNpe052","pIP1","pIP1","DNp35","DNg40","DNp03","DNp02","DNp11","DNp06"],
    N_IN, N_HID, N_OUT, version: "jurassic-connectome-v1",
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

// ===== IMMORTAL FRUIT FLIES theme overlay =====
/* =====================================================================
 * Immortal Fruit Fly — theme overlay for the flyjump workbench.
 *
 * The vendored Jurassic Runner (vendor/jurassic-runner/game.js) stays
 * UNMODIFIED. This file is concatenated into live.js BY THE BUILD
 * (scripts/build-live.mjs) so it shares the game's top-level scope, and
 * its `function` declarations REPLACE the game's sprites:
 *
 *   drawBackground / drawPath  -> overripe-orchard dusk, faux-3D depth
 *   drawProp                   -> fallen fruit & leaf litter
 *   drawObstacle               -> three DISTINCT hazard languages
 *                                    jump = low ground barrier (hop over)
 *                                    duck = wide OVERHEAD trap (duck under)
 *                                    move = tall lane-blocker (dodge)
 *   drawRunner                 -> the fly FLIES: hover, bank, dive, climb
 *   drawChaser / drawTrex      -> giant predator fly
 *   render / crash             -> 3D depth + death text
 *
 * Pure rendering: none of these touch Math.random or mutation, so gameplay
 * and the trained READOUT are bit-identical (verified by test).
 * Two pure spec helpers power the flight feel and the hazard languages so
 * the unit test can assert them directly:
 *   iffPose(state, t)  -> { altitude, bank }  continuous flight geometry
 *   iffHazard(kind)    -> { top, bottom, width } overlap boxes per hazard
 * No top-level `let`/`const` here; only top-level `function` declarations.
 * ===================================================================== */

/* =====================================================================
 * SPEC — continuous flight geometry for the hero.
 * altitude is the fly's body-centre height above the lane surface (px);
 * bank is a roll for lane changes (neg = banking left). Pure: no RNG/state.
 * ===================================================================== */
function iffPose(s, t) {
  const lift = Math.max(0, s.jumpY) * 0.95;   // climb from the jump meter
  const airborne = !s.grounded;
  const bob = airborne ? 0 : Math.sin(t * 0.32) * 4;  // hovering bob
  const duckDip = s.ducking ? 15 : 0;                 // dive when ducking
  const altitude = (airborne ? 12 + lift * 0.9 : 12 + bob) - (airborne ? 0 : duckDip);
  const bank = clamp(s.laneX * 0.5, -1, 1);           // roll left / right with the lane
  return { altitude: Math.max(2, altitude), bank, airborne: !!airborne };
}

/* =====================================================================
 * SPEC — the three hazard languages, as the vertical overlap box the fly
 * must avoid (drawn at the fly plane, t = PLAYER_T). bottom = distance of
 * the hazard's LOWER edge above the surface line; top = its upper edge;
 * width = horizontal footprint.
 *   jump  low ground barrier  (bottom 0, short)    -> hop over it
 *   duck  wide OVERHEAD gap    (bottom high, wide) -> duck under it
 *   move  tall full blocker    (bottom 0, tall)    -> change lane
 * ===================================================================== */
function iffHazard(kind) {
  if (kind === "duck") return { top: 96, bottom: 44, width: 76 };   // flying bird, 44px clear gap
  if (kind === "move") return { top: 104, bottom: 0, width: 34 };   // wooden wall (slimmer, depth stays visible)
  return { top: 26, bottom: 0, width: 44 };                          // ground-level broken road + pond
}

/* =====================================================================
 * RENDER-ONLY PROJECTION SPEC (gameplay projection is untouched — the
 * vendor's laneToX/projHalf stay the single source of truth; these wrap
 * it so every drawn sprite, road edge and divider shares ONE projection).
 *   iffLaneX(lane, t)   exact vendor laneToX — lanes sit at ±1, ±0.5, 0
 *   iffRoadEdge(side,t) road edge = 3-lane extents, i.e. lane ±1.5
 *   iffScale(t)         sprite scale relative to the player plane
 * ===================================================================== */
function iffLaneX(lane, t) { return laneToX(lane, t); }
function iffRoadEdge(side, t) { return W / 2 + side * 1.5 * projHalf(t) * 0.52; }
function iffScale(t) { return projHalf(t) / projHalf(PLAYER_T); }

/* ---- tiny shared helpers ---- */
function js(v, k) { return (Math.sin(v + k * 1.3) * 0.5 + 0.5); }
function tpop(ctx, pts, close, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  if (fill) ctx.fill(); else ctx.stroke();
}
function iffillPs(ctx, col, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
// Ground-contact shadow. The sink (offset below the surface line) scales with
// `s` so a far hazard's shadow hugs its own ground line instead of poking below
// the player plane — keeps depth ordering truthful at every distance.
function ifShadow(ctx, x, groundY, w, h, a, off) {
  const sink = off === undefined ? 4 : off;   // px below the lane surface
  ctx.fillStyle = "rgba(0,0,0,1)"; ctx.globalAlpha = a;
  ctx.beginPath(); ctx.ellipse(x, groundY + sink, w, h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}
function ifgrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i + 1 < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
  ctx.fillStyle = g; return g;
}
function teardrop(c, cx, cy, w, h, rot) {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  c.beginPath();
  c.moveTo(-w * 0.5, 0);
  c.quadraticCurveTo(-w * 0.1, -h * 0.62, w * 0.28, -h * 0.55);
  c.quadraticCurveTo(w * 0.62, -h * 0.18, w * 0.5, 0);
  c.quadraticCurveTo(w * 0.28, h * 0.1, -w * 0.12, h * 0.18);
  c.quadraticCurveTo(-w * 0.42, h * 0.06, -w * 0.5, 0);
  c.closePath(); c.fill(); c.restore();
}

/* ============ the HERO: a 100-year-old fruit fly that FLIES ============ */
function drawRunner() {
  const t = PLAYER_T;
  const x = laneToX(player.laneX, t);
  const ground = projY(t);
  const s = projHalf(t) / projHalf(1) * 1.25;
  const rt = ((window.__IFF_RENDER_ALPHA || 0) * 0.5) + frameCount;         // interp-aware time
  const pose = iffPose(player, rt);

  const alt = pose.altitude;                       // body centre above lane
  const bodyY = ground - alt * s;

  // shadow shrinks & fades as the fly climbs (depth)
  const shA = clamp(0.34 - alt / 320, 0.06, 0.34);
  ifShadow(ctx, x, ground, 20 * s * clamp(1 - alt / 130, 0.35, 1), 6 * s, shA, 4 * s);

  // wing flutter — a soft double-exposure motion blur
  const flap = Math.sin(rt * 0.9);
  ctx.save();
  ctx.translate(x - 2 * s, bodyY);
  ctx.rotate(clamp(pose.bank * 0.28, -0.3, 0.3));
  // ghost wing then main wing (blur trail)
  ctx.globalAlpha = 0.16;
  teardrop(ctx, (pose.bank > 0 ? 4 : -4) * s, -6 * s, 22 * s, 16 * s, flap * 0.6);
  ctx.globalAlpha = 0.34;
  teardrop(ctx, 0, -6 * s, 22 * s, 16 * s, flap);

  // body (silver-grey, aged) — drawn slightly above the surface = hovering
  ctx.fillStyle = "#9aa0a6";
  ctx.beginPath(); ctx.ellipse(0, -2 * s, 11 * s, 7 * s, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a8378";
  ctx.beginPath(); ctx.ellipse(-4 * s, -6 * s, 9 * s, 6 * s, -0.1, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.fillStyle = "#7d7a72";
  ctx.beginPath(); ctx.ellipse(-10 * s, -9 * s, 6 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a0483c";
  ctx.beginPath(); ctx.arc(-14 * s, -10 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-5 * s, -10 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,246,230,0.9)";
  ctx.beginPath(); ctx.arc(-15 * s, -11 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
  // bent antennae (ageing)
  ctx.strokeStyle = "#5c5850"; ctx.lineWidth = 1.7 * s; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-12 * s, -12 * s); ctx.quadraticCurveTo(-18 * s, -17 * s, -14 * s, -20 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6 * s, -12 * s); ctx.quadraticCurveTo(-2 * s, -18 * s, -7 * s, -22 * s); ctx.stroke();
  // legs — dangling loose in flight, splayed when grounded
  ctx.strokeStyle = "#6b6a66"; ctx.lineWidth = 1.6 * s; ctx.lineCap = "round";
  for (const [lx, ph] of [[-6, 0], [0, 1.4], [6, 2.8]]) {
    const d = player.grounded ? 5 * s : 9 * s;
    ctx.beginPath(); ctx.moveTo(lx * s, 0);
    ctx.quadraticCurveTo(lx * s + Math.sin(rt + ph) * 3 * s, d * 0.5, lx * s + Math.sin(rt * 1.5 + ph) * 4 * s, d);
    ctx.stroke();
  }
  ctx.restore();
}

/* ============ three DISTINCT hazard languages ============ */
function drawJumpHazard(ctx2, x, y, s) {
  // a broken stretch of road filled with a pond (hop over it).
  ifShadow(ctx2, x, y, 34 * s, 5 * s, 0.34, 4 * s);
  // ragged broken-edge basin (jagged right edge = the gap in the road)
  const g = ctx2.createLinearGradient(x - 20 * s, y - 10 * s, x + 20 * s, y + 2 * s);
  g.addColorStop(0, "#6e5638"); g.addColorStop(1, "#40301e");
  ctx2.fillStyle = g;
  ctx2.beginPath();
  ctx2.moveTo(x - 22 * s, y);
  ctx2.lineTo(x - 18 * s, y - 4 * s);
  ctx2.lineTo(x - 6 * s, y - 12 * s);
  ctx2.lineTo(x + 6 * s, y - 8 * s);
  ctx2.lineTo(x + 14 * s, y - 13 * s);
  ctx2.lineTo(x + 22 * s, y - 5 * s);
  ctx2.lineTo(x + 22 * s, y);
  ctx2.closePath(); ctx2.fill();
  // pond water surface sitting flush at the tops of the broken edges
  const wg = ctx2.createLinearGradient(x - 17 * s, y - 11 * s, x + 17 * s, y - 11 * s);
  wg.addColorStop(0, "#2f5a52"); wg.addColorStop(0.5, "#3f6f66"); wg.addColorStop(1, "#2a4c47");
  ctx2.fillStyle = wg;
  ctx2.beginPath();
  ctx2.moveTo(x - 19 * s, y - 6 * s);
  ctx2.quadraticCurveTo(x - 8 * s, y - 13 * s, x + 3 * s, y - 11 * s);
  ctx2.quadraticCurveTo(x + 12 * s, y - 14 * s, x + 19 * s, y - 6 * s);
  ctx2.lineTo(x + 19 * s, y - 2 * s);
  ctx2.lineTo(x - 19 * s, y - 2 * s);
  ctx2.closePath(); ctx2.fill();
  // glints so water reads as liquid
  ctx2.strokeStyle = "rgba(230,244,238,0.55)"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 11 * s, y - 7 * s); ctx2.lineTo(x - 3 * s, y - 8 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 5 * s, y - 9 * s); ctx2.lineTo(x + 11 * s, y - 8 * s); ctx2.stroke();
  // exposed rebar / jagged chip on the broken lip (readable "damaged road")
  ctx2.strokeStyle = "#4a3a2c"; ctx2.lineWidth = 2 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 15 * s, y - 2 * s); ctx2.lineTo(x - 9 * s, y - 5 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 10 * s, y - 1 * s); ctx2.lineTo(x + 15 * s, y - 4 * s); ctx2.stroke();
}
function drawDuckTrap(ctx2, x, y, s) {
  // a FLYING BIRD strung across the lane: duck UNDER it (bird stays aloft;
  // a ground-contact shadow tells you how far away it really is).
  const h = iffHazard("duck");
  const topY = y - h.top * s, botY = y - h.bottom * s, midY = (topY + botY) / 2;
  const flap = Math.sin(frameCount * 0.5) * 0.5;
  // ground-contact shadow (lanes, not overhead): shrinks with altitude
  ifShadow(ctx2, x, y, 26 * s * clamp(1 - h.top / 300, 0.45, 1), 4 * s, 0.22, 4 * s);
  // wings (upswept, above the body, flapping)
  const wg = ctx2.createLinearGradient(x - 8 * s, topY, x + 8 * s, topY);
  wg.addColorStop(0, "#e6e6e6"); wg.addColorStop(1, "#b9b3a8");
  ctx2.fillStyle = wg;
  ctx2.beginPath(); ctx2.moveTo(x, topY + 2 * s);
  ctx2.quadraticCurveTo(x - 22 * s, topY - (16 + flap * 16) * s, x - h.width * 0.36 * s, topY + 3 * s);
  ctx2.quadraticCurveTo(x - 4 * s, topY + 7 * s, x, topY + 3 * s);
  ctx2.closePath(); ctx2.fill();
  ctx2.beginPath(); ctx2.moveTo(x, topY + 2 * s);
  ctx2.quadraticCurveTo(x + 22 * s, topY - (16 + flap * 16) * s, x + h.width * 0.36 * s, topY + 3 * s);
  ctx2.quadraticCurveTo(x + 4 * s, topY + 7 * s, x, topY + 3 * s);
  ctx2.closePath(); ctx2.fill();
  // body (bird): tucked toward the bottom of the overhead box
  ctx2.fillStyle = "#6d6a60";
  ctx2.beginPath(); ctx2.ellipse(x, midY + 6 * s, h.width * 0.30 * s, 11 * s, 0, 0, Math.PI * 2); ctx2.fill();
  ctx2.fillStyle = "#e8e4da";
  ctx2.beginPath(); ctx2.ellipse(x - 8 * s, midY + 4 * s, 8 * s, 9 * s, 0, 0, Math.PI * 2); ctx2.fill();
  ctx2.beginPath(); ctx2.arc(x - 14 * s, midY + 4 * s, 4 * s, 0, Math.PI * 2); ctx2.fill();
  // beak (amber) pointing toward travel
  ctx2.fillStyle = "#c98b2e";
  ctx2.beginPath(); ctx2.moveTo(x - 18 * s, midY + 3 * s); ctx2.lineTo(x - 26 * s, midY + 2 * s); ctx2.lineTo(x - 16 * s, midY + 8 * s); ctx2.closePath(); ctx2.fill();
  // eye
  ctx2.fillStyle = "#d9d3c8";
  ctx2.beginPath(); ctx2.arc(x - 10 * s, midY + 1 * s, 2.4 * s, 0, Math.PI * 2); ctx2.fill();
  ctx2.fillStyle = "#141312";
  ctx2.beginPath(); ctx2.arc(x - 10 * s, midY + 1 * s, 1.2 * s, 0, Math.PI * 2); ctx2.fill();
  // feet — dangle beneath the body toward the lane (readable as overhead)
  ctx2.strokeStyle = "#b9a24a"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 4 * s, botY - 4 * s); ctx2.lineTo(x - 6 * s, botY + 1 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 4 * s, botY - 6 * s); ctx2.lineTo(x + 6 * s, botY + 1 * s); ctx2.stroke();
  // thin lower fringe: the "duck under me" line
  ctx2.strokeStyle = "rgba(74,72,64,0.65)"; ctx2.lineWidth = 1.8 * s;
  ctx2.beginPath(); ctx2.moveTo(x - h.width * 0.5 * s, botY); ctx2.lineTo(x + h.width * 0.5 * s, botY); ctx2.stroke();
}
function drawMovePlant(ctx2, x, y, s) {
  // a tall WOODEN WALL blocking the lane — must change lane.
  ifShadow(ctx2, x, y, 26 * s, 5 * s, 0.32, 4 * s);
  const h = iffHazard("move");
  const topY = y - h.top * s;
  // weathered plank (vertical grain, slightly tapered toward the top)
  const g = ctx2.createLinearGradient(x - 9 * s, topY, x + 9 * s, y);
  g.addColorStop(0, "#8f7a50"); g.addColorStop(0.5, "#a08b5c"); g.addColorStop(1, "#6e5a38");
  ctx2.fillStyle = g;
  ctx2.beginPath();
  ctx2.moveTo(x - 11 * s, y);
  ctx2.lineTo(x - 8 * s, topY + 8 * s);
  ctx2.lineTo(x - 5 * s, topY);
  ctx2.lineTo(x + 5 * s, topY);
  ctx2.lineTo(x + 8 * s, topY + 8 * s);
  ctx2.lineTo(x + 14 * s, y);
  ctx2.closePath(); ctx2.fill();
  // vertical plank seams + grain (reads as timber)
  ctx2.strokeStyle = "rgba(84,66,40,0.7)"; ctx2.lineWidth = 1.4 * s; ctx2.lineCap = "round";
  for (const off of [-5, 1]) {
    ctx2.beginPath(); ctx2.moveTo(x + off * s, y - 6 * s); ctx2.lineTo(x + off * s, topY + 10 * s); ctx2.stroke();
  }
  ctx2.strokeStyle = "rgba(96,78,48,0.5)"; ctx2.lineWidth = 1.1 * s;
  for (let i = -3; i <= 3; i++) {
    ctx2.beginPath(); ctx2.moveTo(x + i * 2.5 * s, y - i * 2 * s); ctx2.quadraticCurveTo(x + (i + 2) * 2 * s, y - (i + 3) * 3 * s, x + (i % 2 ? 2 : -2) * s, topY + (2 + i) * 5 * s); ctx2.stroke();
  }
  // flat plank top cap + a nail dot
  ctx2.fillStyle = "#7a6846";
  ctx2.fillRect(x - 6 * s, topY - 4 * s, 12 * s, 5 * s);
  ctx2.fillStyle = "rgba(40,32,22,0.7)";
  ctx2.beginPath(); ctx2.arc(x, topY - 1.5 * s, 1.4 * s, 0, Math.PI * 2); ctx2.fill();
  // a small grass tuft by the base anchors it to the ground line
  ctx2.strokeStyle = "#5c7640"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 17 * s, y); ctx2.quadraticCurveTo(x - 18 * s, y - 6 * s, x - 15 * s, y - 10 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 15 * s, y); ctx2.quadraticCurveTo(x + 16 * s, y - 6 * s, x + 13 * s, y - 10 * s); ctx2.stroke();
}
function drawObstacle(o) {
  const x = laneToX(o.lane, o.t);
  const y = projY(o.t);
  const s = iffScale(o.t);
  if (s < 0.02) return;
  if (o.avoid === "duck") return drawDuckTrap(ctx, x, y, s);
  if (o.avoid === "move") return drawMovePlant(ctx, x, y, s);
  drawJumpHazard(ctx, x, y, s);
}

/* ============ the giant predator fly (chase + death) ============ */
function drawGiantPredator(cx, groundY, sc, open, runP) {
  ctx.save(); ctx.translate(cx, groundY); ctx.scale(sc, sc);
  const flap = Math.sin(runP * 0.6) * 0.5 + 0.5;
  teardrop(ctx, -34, -150, 60, 40, -0.6 + flap * 0.3);
  teardrop(ctx, 34, -150, 60, 40, 0.6 + flap * 0.3);
  ctx.fillStyle = "#3a2c26";
  ctx.beginPath(); ctx.moveTo(-52, -84); ctx.quadraticCurveTo(0, -28 + open, 52, -84); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c98b2e";
  for (let i = 0; i < 5; i++) ctx.fillRect(-42, -64 + i * 9, 84, 2.6);
  ctx.fillStyle = "#54423a"; ctx.beginPath(); ctx.ellipse(0, -130, 42, 34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2f2824"; ctx.beginPath(); ctx.ellipse(0, -174, 32, 27, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c23b2e"; ctx.beginPath(); ctx.arc(-14, -186, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(14, -186, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,240,230,0.9)";
  ctx.beginPath(); ctx.arc(-17, -189, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11, -189, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#c98b2e"; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-13, -162); ctx.lineTo(-24, -122 - open); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(13, -162); ctx.lineTo(24, -122 - open); ctx.stroke();
  ctx.strokeStyle = "#3a3a40"; ctx.lineWidth = 7;
  for (let i = 0; i < 3; i++) { const b = -26 + i * 26; ctx.beginPath(); ctx.moveTo(b, -62); ctx.lineTo(b - 28, 8 + (i % 2) * 8); ctx.lineTo(b - 36, 36); ctx.stroke(); }
  ctx.restore();
}
function drawChaser() {
  const f = frameCount, surge = Math.max(0, Math.sin(f * 0.025)), lunge = surge * surge;
  drawGiantPredator(W / 2 - player.laneX * 30 + Math.sin(f * 0.04) * 26, H + 120 - lunge * 170 + Math.sin(f * 0.3) * 4, 0.62, 24 + lunge * 42, f * 0.3);
}
function drawTrex() {
  const p = clamp((1.36 - trexT) / 0.4, 0, 1);
  drawGiantPredator(W / 2 - 285 * (0.8 + p * 0.5) + player.laneX * 14, H + 120 - p * 360, 0.8 + p * 0.5, 30 + p * 50 + Math.sin(frameCount * 0.3) * 6, frameCount * 0.4);
}

/* ============ backdrop: overripe orchard at dusk, with depth ============ */
function drawOldTree(cx, cy, sc) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -56); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(-22, -62); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(22, -64); ctx.stroke();
  const g = ctx.createLinearGradient(0, -102, 0, -56);
  g.addColorStop(0, "#4a4630"); g.addColorStop(1, "#5c5436");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(-11, -84, 22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(12, -86, 20, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -98, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a3442d";
  for (let i = 0; i < 3; i++) { const hx = -14 + i * 12, hy = -60 + (i % 2) * 5; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function drawBackground() {
  ifgrad(ctx, 0, 0, 0, HORIZON + 70, [0, "#241f33", 0.45, "#5b3c4a", 0.8, "#c8773f", 1, "#e8a84f"]);
  ctx.fillRect(0, 0, W, HORIZON + 70);
  ctx.fillStyle = "rgba(255,214,150,0.9)";
  ctx.beginPath(); ctx.arc(W * 0.34, HORIZON - 20, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,236,200,0.5)";
  ctx.beginPath(); ctx.arc(W * 0.34, HORIZON - 20, 28, 0, Math.PI * 2); ctx.fill();
  ifgrad(ctx, 0, HORIZON - 70, 0, HORIZON + 40, [0, "rgba(240,170,110,0)", 0.6, "rgba(240,180,120,0.35)", 1, "rgba(170,110,70,0.05)"]);
  ctx.fillRect(0, HORIZON - 70, W, 110);
  const par = -player.laneX * 26;
  drawOldTree(((frameCount * 0.05 + 130) % (W + 360)) - 180 + par * 0.15, HORIZON - 2, 0.45);
  drawOldTree(((frameCount * 0.18) % (W + 320)) - 160 + par * 0.5, HORIZON - 4, 0.9);
  drawOldTree(W + 160 - ((frameCount * 0.12) % (W + 320)) + par * 0.5, HORIZON - 2, 1.05);
  drawOldTree(W * 0.55 + par * 0.7, HORIZON - 6, 0.62);
  for (let i = 0; i < 10; i++) {
    const fy = HORIZON - ((frameCount * 0.6 + i * 41) % (H - HORIZON + 140)) * 0.9;
    const fx = (i * 71 + worldScroll * 0.01 * (i % 3 + 1)) % (W + 60) - 30;
    ctx.fillStyle = "rgba(255,200,120,1)"; ctx.globalAlpha = 0.5 * (0.4 + 0.6 * js(frameCount * 0.1, i));
    ctx.beginPath(); ctx.arc(fx, fy, 1.2 + (i % 2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ============ the avenue: faux-3D converging road ============ */
function drawPath() {
  ifgrad(ctx, 0, HORIZON, 0, H, [0, "#7a5f40", 1, "#4f3824"]);
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  // road body spans the full 3-lane extents (lane ±1.5) at EVERY depth —
  // same projection as hazards, so lanes never spill onto the verge.
  ctx.beginPath();
  ctx.moveTo(iffRoadEdge(-1, 0), projY(0));
  for (let t = 0; t <= 1.0001; t += 0.05) ctx.lineTo(iffRoadEdge(-1, t), projY(t));
  for (let t = 1; t >= 0; t -= 0.05) ctx.lineTo(iffRoadEdge(1, t), projY(t));
  ctx.closePath();
  ifgrad(ctx, 0, HORIZON, 0, H, [0, "#8a6a44", 1, "#5c4128"]); ctx.fill();
  // dirt speckles that grow toward the viewer (depth)
  ctx.fillStyle = "rgba(60,40,22,0.5)";
  for (let i = 0; i < 26; i++) {
    const tt = ((i * 47 + worldScroll * 0.02) % 1000) / 1000, tt2 = ((i * 91 + worldScroll * 0.02) % 1000) / 1000;
    const lane = ((i * 13) % 2 ? 1 : -1) * (0.2 + (i * 7) % 50 * 0.03);
    ctx.beginPath(); ctx.arc(iffLaneX(lane * 0.9, tt2) + (i * 3) % 7, projY(tt2), (0.8 + tt * 3.2) * 1.4, 0, Math.PI * 2); ctx.fill();
  }
  // perspective depth markers: full-width cross rings at receding depths
  // (spacing compresses toward the horizon so speed is readable).
  const period = 0.11;
  const off = ((worldScroll * 0.0009) % period + period) % period;
  for (let t = off; t <= 1; t += period) {
    ctx.beginPath();
    ctx.lineWidth = 1 + t * 5;
    ctx.moveTo(iffRoadEdge(-1, t), projY(t));
    ctx.lineTo(iffRoadEdge(1, t), projY(t));
    ctx.stroke();
  }
  // lane dividers BETWEEN the lanes at lane ±0.5 (NOT the vendor's lane ±1, so
  // each divider marks the true boundary of the lane the fly moves through).
  // 0.05-depth vertices keep them perfectly aligned with the road-edge polylines.
  ctx.strokeStyle = "rgba(232,196,128,0.75)"; ctx.lineCap = "round";
  for (const d of [-0.5, 0.5]) {
    ctx.save(); ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(iffLaneX(d, 0), projY(0));
    let pen = true;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const px = iffLaneX(d, t), py = projY(t);
      if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      pen = !pen;
    }
    ctx.stroke(); ctx.restore();
  }
}

/* ============ props: fallen fruit & leaf litter ============ */
function drawProp(p) {
  const x = edgeX(p.side, p.t) + p.side * p.off * projHalf(p.t);
  const y = projY(p.t); const s = projHalf(p.t) / projHalf(1) * 1.1;
  if (s < 0.02) return;
  if (p.kind === "bush") {
    ifShadow(ctx, x, y, 16 * s, 4 * s, 0.28, 4 * s);
    ctx.fillStyle = "#8a4a2a"; ctx.beginPath(); ctx.arc(x, y - 4 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9 * s, y - 3 * s, 5.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b33a2a"; ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4c2818"; ctx.beginPath(); ctx.arc(x - 1 * s, y - 6 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.save(); ctx.rotate(0.4);
    ctx.strokeStyle = "#6f5f33"; ctx.lineWidth = 3 * s; ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 12 * s, y - 30 * s, x + i * 22 * s, y - 50 * s); ctx.stroke(); }
    ctx.restore();
  }
}

/* ============ death / ready text ============ */
function crash(ts) {
  phase = "dead"; restartAt = ts + 3000; trexT = 1.3; action = "CAUGHT";
  overlayTitle.textContent = "CAUGHT!";
  overlayText.textContent = "Survived " + elapsed.toFixed(1) + "s and scored " + score +
    ". A fruit-fly predator got you — restarting in 3s.";
  startBtn.style.display = "none"; overlay.classList.remove("hidden");
  if (window.Jungle) Jungle.roar();
}

/* belt-and-suspenders: guarantee the overrides are the live bindings */
if (typeof window !== "undefined") {
  window.drawRunner = drawRunner;
  window.drawBackground = drawBackground;
  window.drawPath = drawPath;
  window.drawProp = drawProp;
  window.drawObstacle = drawObstacle;
  window.drawChaser = drawChaser;
  window.drawTrex = drawTrex;
  window.crash = crash;
  window.iffPose = iffPose;
  window.iffHazard = iffHazard;
  window.iffLaneX = iffLaneX;
  window.iffRoadEdge = iffRoadEdge;
  window.iffScale = iffScale;
}
// ===== runtime clock overlay =====
/* =====================================================================
 * runtime.js — refresh-independent live game clock + agent scheduler.
 *
 * scripts/build-live.mjs concatenates this AFTER theme.js into the single
 * live.js script so everything shares one top-level scope. The ONLY bindings
 * that can override the vendored game are TOP-LEVEL `function` declarations
 * here — a later declaration hoists over the earlier one for the whole file.
 * That is exactly why `frame`, `connectWS`, `initCam` and `maybeSend` are
 * declared at top level: the vendored load-time calls (`connectWS(); initCam();
 * requestAnimationFrame(frame)` at its tail) resolve to THESE versions.
 *
 * (Internal clock state is kept in an IIFE + window hooks, never in the way.)
 *
 * Responsibilities (game physics / graph / champion untouched):
 *   1. Fixed 60 Hz simulation clock — game.update() runs 60 times per
 *      real-time second regardless of the display's frame rate
 *      (30 / 60 / 120 / 144 Hz all produce the SAME 60 sim updates/s).
 *   2. Agent scheduling — the trained decide() runs every 2 sim ticks
 *      (~30 decisions/s), replacing the old setInterval(decide, 32).
 *   3. No catch-up on resume — a timestamp gap larger than GAP_MS (hidden
 *      tab, throttled background tab, initial load, long GC) is treated as a
 *      pause and skips the accumulated time instead of bursting updates.
 *   4. Optional smooth-render interpolation hook — window.__IFF_RENDER_ALPHA
 *      is the 0..1 fraction toward the next sim tick each display frame, so
 *      the (parent-owned) theme can interpolate between ticks for smooth
 *      motion on high-refresh displays without breaking the fixed-step sim.
 *   5. Disable unnecessary camera / WebSocket startup (no permission prompt,
 *      no :8765 socket), and reset the circuit's activity buffer per run.
 * ===================================================================== */
(function () {
  "use strict";

  const STEP = 1000 / 60;   // fixed 60 Hz simulation timestep (ms)
  const GAP_MS = 250;       // gaps larger than this are a pause, never catch-up
  const MAX_STEPS = 8;      // safety cap on update()s per display frame

  // ---- pure, testable fixed-step clock (independent instances) ----
  // Tests drive synthetic display rates through MakeClock without touching the
  // live loop. advance(now) returns { updates, alpha, tick }:
  //   updates = number of 60 Hz sim ticks to run (0 while merely waiting),
  //   alpha   = sub-tick fraction toward the next tick, for draw interpolation.
  function MakeClock() {
    let last = null, acc = 0, tick = 0, alpha = 0;
    function reset(now) { last = now; acc = 0; alpha = 0; }
    function advance(now) {
      if (last === null) { last = now; tick = 0; alpha = 0; return { updates: 0, alpha: 0, tick: 0 }; }
      let dt = now - last;
      last = now;
      if (dt > GAP_MS) { acc = 0; alpha = 0; return { updates: 0, alpha: 0, tick }; }
      acc += dt;
      let updates = 0;
      while (acc >= STEP && updates < MAX_STEPS) { acc -= STEP; updates++; tick++; }
      alpha = acc / STEP;
      return { updates, alpha, tick };
    }
    return {
      reset, advance, STEP,
      get tick() { return tick; },
      get alpha() { return alpha; },
    };
  }

  window.__IFF_MAKE_CLOCK = MakeClock;
  window.__IFF_STEP = STEP;
  window.__IFF_LIVE_CLOCK = MakeClock();   // the single live accumulator
})();

/* ---- neutralize camera / WebSocket startup (TOP-LEVEL => hoists over the
 *      vendor's load-time connectWS()/initCam() calls): no getUserMedia
 *      permission prompt, no :8765 socket on this agent-driven page. ---- */
function connectWS() { ws = null; wsReady = true; }
function initCam() { camReady = true; return Promise.resolve(true); }
function maybeSend() {}

/* ---- reset the circuit per run (offline determinism unaffected) ----
 * Wrap startRun so a fresh run zeroes the circuit's activity buffer. Offline
 * coverage tests boot a fresh VM per seed, so this never changes policy counts;
 * live it stops one run's stale circuit state leaking into the next. */
var __iffOrigStartRun = startRun;
startRun = function () {
  __iffOrigStartRun();
  var J = window.__FLYJUMP;
  if (J && typeof J.resetCircuit === "function") J.resetCircuit();
};

/* ---- fixed 60 Hz frame loop (TOP-LEVEL `function frame` replaces the
 *      vendored `frame`: hoisting makes the tail's requestAnimationFrame(frame)
 *      bind to THIS one). ---- */
var __iffTick = 0;            // cumulative simulation-tick counter (per update)
var __iffDecidedTick = -1;    // last tick a decision was taken on
var __iffLiveClock = window.__IFF_LIVE_CLOCK;

/* ---- human-input separation. The AGENT writes KB directly, so `usingKb`
 *      (set whenever any key is held) is true for agent actions too — gating
 *      decide() on it would wedge auto-play after the first non-idle decision
 *      (the fly would hold one key forever). Only REAL keydown events set
 *      __iffHuman; we cede the wheel to the human for 200 ms after one and let
 *      auto resume after. The agent never triggers this signal. ---- */
var __iffHuman = -9999;
try {
  window.addEventListener("keydown", function (e) {
    var k = e && e.key;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === " ") __iffHuman = performance.now();
  });
} catch (_) {}
window.__IFF_NOTE_HUMAN_INPUT = function () { __iffHuman = performance.now(); };
window.__IFF_HUMAN_ACTIVE = function () { return performance.now() - __iffHuman < 200; };

function frame(ts) {
  const r = __iffLiveClock.advance(ts);
  // publish optional render-interpolation alpha + clock telemetry
  window.__IFF_RENDER_ALPHA = r.alpha;
  window.__IFF_CLOCK_STATE = r;

  if (r.updates) {
    for (let i = 0; i < r.updates; i++) {
      update(ts);
      __iffTick++;
      // agent decides every 2 sim ticks (~30 decisions/s at 60 Hz sim) —
      // cede only to a REAL keypress (auto resumes ~200ms after release).
      if ((__iffDecidedTick < 0 || __iffTick - __iffDecidedTick >= 2) && !window.__IFF_HUMAN_ACTIVE()) {
        const J = window.__FLYJUMP;
        if (J && typeof J.decide === "function") { J.decide(); __iffDecidedTick = __iffTick; }
      }
    }
  }

  render(ts); // themed scene: current sim state (+ __IFF_RENDER_ALPHA to smooth)
  requestAnimationFrame(frame);
}

window.__IFF_FRAME = frame; // reference the replacement loop (diagnosis only)

// ===== Sound: muted on load; the header SOUND button flips it manually =====
// Vendored Jungle (audio.js) exposes only toggle(); calling it once at boot
// puts the engine in a known muted state BEFORE any autoplay, then the button
// unmutes. Guarded so headless boots (no audio.js) stay inert.
(function () {
  function syncSound(on) {
    var b = document && document.getElementById && document.getElementById("audio-toggle");
    if (!b) return;
    b.textContent = on ? "SOUND: ON" : "SOUND: OFF";
    if (b.setAttribute) b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (!window.Jungle) return;
  try { syncSound(!window.Jungle.toggle()); } catch (_) { syncSound(false); }
  var btn = document && document.getElementById && document.getElementById("audio-toggle");
  if (btn && btn.addEventListener) btn.addEventListener("click", function () {
    var m = false;
    try {
      m = window.Jungle.toggle();
      // unmuting => ensure the engine is actually running so sound is audible
      if (!m && window.Jungle.start) window.Jungle.start();
    } catch (_) {}
    syncSound(!m);
  });
})();
