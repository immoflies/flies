import * as THREE from '../vendor/three.module.js';
import { Brain } from './brain.js';
import { motorSenses } from './motor.js';
import { ArmRig } from './arm.js';
import { bladeCuts } from './contact.js';

/* ============================================================================
 * Fruit Fly Saber — third-person AUTONOMOUS scene
 * ----------------------------------------------------------------------------
 * A procedural fruit fly flies down a dark neon runway; its two forelegs ARE
 * the sabers (left = cyan, right = rose). Play is wholly autonomous: a fixed
 * 1/60s sim tick reads the circuit output features to drive joint angles.
 * The older WAIT/L/R readout is diagnostic only. No keyboard, no pointer slicing. The sole
 * spectator input is the sound toggle. brain.draw() renders the modeled 80-cell
 * circuit (a task-trained readout subset, not the whole brain) onto the side
 * canvas. The scene starts automatically when its graph and readout load.
 * ==========================================================================*/

const $ = id => document.getElementById(id);
import { HIT_Z, WIN, SPAWN_Z, SPEED, PASS_Z, SIM_DT, COOLDOWN, BEAT, LANES, COLORS, spawnChoice, colorFor } from './config.js';
import { updatePanels } from './panels.js';

/* ---- metrics / HUD ------------------------------------------------------- */
const stats = { score: 0, hits: 0, misses: 0, swings: 0, frames: 0, ticks: 0, error: null, controllerReady: false };
let lastOutputs = new Array(16).fill(0), lastInputs = new Array(8).fill(0), lastTip = null;
let notes = [], particles = [], spawned = 0;
let simTime = 0, nextBeat = 0.3;
let armRig = new ArmRig();
const laneHits = {L:0,C:0,R:0}, laneSpawns = {L:0,C:0,R:0};
const centerHits = {L:0,R:0};

window.saberDebug = () => ({
  score: stats.score, hits: stats.hits, misses: stats.misses,
  swings: stats.swings, frames: stats.frames, ticks: stats.ticks,
  notes: notes.length, spawned, humanInput: false, controllerReady: stats.controllerReady,
  scoring: 'moving-blade-contact-v1', paused: document.hidden, error: stats.error,
  centerHits: {...centerHits}, lanes: Object.keys(LANES), laneHits: {...laneHits}, laneSpawns: {...laneSpawns},
  controller: 'MaleCNS subset → trained motor joints (strict cyan=L, rose=R)',
  motor: armRig.telemetry(), bladePositions: Object.fromEntries(Object.entries(arms).map(([s,a])=>[s,{base:a.worldBase.slice(),tip:a.worldTip.slice()}]))
});
function fail(error) {
  stats.error = String((error && error.message) || error);
  $('error').textContent = stats.error;
  $('status').textContent = stats.controllerReady ? 'AUTONOMOUS / DEGRADED' : 'MODEL OFFLINE';
}

/* ---- renderer / camera (third person: behind & above the fly) ------------ */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x060914);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x060914, 24, 62);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 110);
camera.position.set(0, 5.4, 4.8);
camera.lookAt(0, 1.35, -15);             // gaze down the runway, fly centered
scene.add(new THREE.HemisphereLight(0xbbd7ff, 0x283747, 2.6));
const key = new THREE.DirectionalLight(0xe8f8ff, 3.3);
key.position.set(-4, 8, 2); scene.add(key);
const rim = new THREE.PointLight(0x51ddff, 35, 16);
rim.position.set(0, 4, -10); scene.add(rim);

/* ---- small object/material helpers --------------------------------------- */
const glow = color => new THREE.MeshBasicMaterial({ color });
const metallic = new THREE.MeshStandardMaterial({ color: 0x343b49, metalness: 0.5, roughness: 0.38 });
const dark = new THREE.MeshStandardMaterial({ color: 0x141c2c, metalness: 0.35, roughness: 0.5 });
const legMat = new THREE.MeshStandardMaterial({ color: 0x71889c, metalness: 0.65, roughness: 0.32 });
const sphere = new THREE.SphereGeometry(1, 20, 14);
function mesh(geometry, material, parent, position = [0, 0, 0], scale = [1, 1, 1]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(position[0], position[1], position[2]);
  object.scale.set(scale[0], scale[1], scale[2]);
  parent.add(object);
  return object;
}
function ellipsoid(parent, material, position, scale) { return mesh(sphere, material, parent, position, scale); }
function segment(parent, from, to, radius, material) {
  const a = new THREE.Vector3(from[0], from[1], from[2]);
  const b = new THREE.Vector3(to[0], to[1], to[2]);
  const object = mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material, parent);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  return object;
}

/* ---- dark neon runway ------------------------------------------------------ */
mesh(new THREE.BoxGeometry(7.6, 0.18, 70), dark, scene, [0, -0.17, -25]);
const roadLines = [];
for (const x of [-3.7, -0.725, 0.725, 3.7]) {
  mesh(new THREE.BoxGeometry(x === 0 ? 0.018 : 0.045, 0.022, 70),
    glow(x < 0 ? 0x26768e : x > 0 ? 0x843551 : 0x27334d), scene, [x, -0.06, -25]);
}
for (let z = -58; z < 4; z += 3.4) roadLines.push(mesh(new THREE.BoxGeometry(7.4, 0.012, 0.026), glow(0x1c344c), scene, [0, -0.055, z]));
for (let z = -17; z > -60; z -= 8) {
  for (const side of ['L', 'R']) {
    const x = side === 'L' ? -4.6 : 4.6;
    segment(scene, [x, 0, z], [x, 4.1, z], 0.035, glow(side === 'L' ? 0x17495e : 0x502039));
    segment(scene, [x, 4.1, z], [x * 0.75, 5.0, z], 0.035, glow(0x27344e));
  }
}
/* gates aligned to the slicing plane at HIT_Z, one per lane */
const gates = {};
for (const side of ['L', 'C', 'R']) {
  const gate = mesh(new THREE.RingGeometry(0.65, 0.68, 4),
    new THREE.MeshBasicMaterial({ color: COLORS[side], transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    scene, [LANES[side], 1.6, HIT_Z]);
  gate.rotation.z = Math.PI / 4; gates[side] = gate;
  mesh(new THREE.BoxGeometry(1.3, 0.015, 0.16), glow(COLORS[side]), scene, [LANES[side], -0.035, HIT_Z]);
}

/* ===========================================================================
 * PROCEDURAL FLY — abdomen, thorax, head, glossy compound eyes, fluttering
 * translucent wings, six segmented legs. The front legs end in hand-joints
 * that hold the glowing cyan / rose saber blades (their tips reach HIT_Z).
 * The fly faces -Z; the camera sits behind and above its abdomen.
 * ==========================================================================*/
const fly = new THREE.Group(); fly.position.set(0, 1.65, -4.85); scene.add(fly);
ellipsoid(fly, metallic, [0, 0, 0.52], [0.43, 0.36, 0.87]);
ellipsoid(fly, dark, [0, 0.08, -0.25], [0.5, 0.42, 0.5]);
ellipsoid(fly, metallic, [0, 0.13, -0.82], [0.43, 0.34, 0.36]);
for (let i = 0; i < 4; i++) {
  const band = mesh(new THREE.TorusGeometry(0.37 - i * 0.04, 0.022, 6, 24), legMat, fly, [0, 0, 0.28 + i * 0.25]);
  band.scale.y = 0.82;
}
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xe34447, emissive: 0x701621, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.4 });
for (const sign of [-1, 1]) {
  const eye = mesh(new THREE.IcosahedronGeometry(1, 2), eyeMat, fly, [sign * 0.34, 0.2, -0.84], [0.22, 0.29, 0.29]);
  ellipsoid(eye, glow(0xffbdad), [-0.2, 0.5, -0.3], [0.16, 0.13, 0.13]);
  segment(fly, [sign * 0.17, 0.32, -1.04], [sign * 0.29, 0.55, -1.33], 0.015, legMat);
  ellipsoid(fly, legMat, [sign * 0.29, 0.55, -1.33], [0.04, 0.055, 0.04]);
  for (const z of [0.15, 0.7]) {
    const knee = [sign * 0.88, -0.3, z + 0.22];
    const foot = [sign * 1.13, -0.64, z + 0.65];
    segment(fly, [sign * 0.32, -0.12, z], knee, 0.035, legMat);
    segment(fly, knee, foot, 0.022, legMat);
    segment(fly, foot, [sign * 1.26, -0.69, z + 0.84], 0.017, legMat);
    ellipsoid(fly, metallic, knee, [0.06, 0.06, 0.06]);
  }
}
const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xb2eaff, transparent: true, opacity: 0.38,
  metalness: 0.1, roughness: 0.22, side: THREE.DoubleSide, depthWrite: false });
const wings = [];
for (const sign of [-1, 1]) {
  const pivot = new THREE.Group(); pivot.position.set(sign * 0.28, 0.31, -0.1); fly.add(pivot);
  ellipsoid(pivot, wingMat, [sign * 0.82, 0, 0.35], [1.05, 0.026, 0.45]);
  const veinMat = new THREE.MeshBasicMaterial({ color: 0x6ba4be, transparent: true, opacity: 0.5 });
  segment(pivot, [0, 0.02, 0], [sign * 1.77, 0.02, 0.35], 0.009, veinMat);
  for (const endZ of [0.1, 0.52, 0.7]) segment(pivot, [sign * 0.3, 0.02, 0.1], [sign * 1.3, 0.02, endZ], 0.006, veinMat);
  wings.push({ pivot, sign });
}

/* ---- articulated saber forelegs (driven each tick by ArmRig bridge outputs) - */
const ARM_SPAN = 2.6;                 // blade tip reaches toward the slicing plane
const arms = {};
for (const side of ['L', 'R']) {
  const sign = side === 'L' ? -1 : 1;
  const root = new THREE.Group(); root.position.set(sign * 0.3, -0.08, -0.48); fly.add(root);
  const yaw = new THREE.Group(); root.add(yaw);
  const pitch = new THREE.Group(); yaw.add(pitch);
  segment(pitch, [0, 0, 0], [sign * 0.51, 0, -ARM_SPAN * 0.3], 0.047, legMat);
  const elbow = new THREE.Group(); elbow.position.set(sign * 0.51, 0, -ARM_SPAN * 0.3); pitch.add(elbow);
  segment(elbow, [0, 0, 0], [sign * 0.5, 0, -ARM_SPAN * 0.24], 0.036, legMat);
  const wrist = new THREE.Group(); wrist.position.set(sign * 0.5, 0, -ARM_SPAN * 0.24); elbow.add(wrist);
  const bladeLen = ARM_SPAN * 0.5;
  // Presentation only: a tight core inside two additive, side-colored halos.
  // The old opaque white sheath hid the thinner colored blade completely.
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, bladeLen, 12),
    new THREE.MeshBasicMaterial({ color: COLORS[side], toneMapped: false }));
  blade.rotation.x = -Math.PI / 2; blade.position.set(0, 0, -bladeLen / 2); wrist.add(blade);
  for (const [radius, opacity] of [[0.075, 0.42], [0.14, 0.14]]) {
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, bladeLen, 16),
      new THREE.MeshBasicMaterial({ color: COLORS[side], transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.set(0, 0, -bladeLen / 2); wrist.add(halo);
  }
  ellipsoid(wrist, metallic, [0, 0, 0], [0.1, 0.09, 0.12]);
  const tip = new THREE.Object3D(); tip.position.set(0, 0, -bladeLen); wrist.add(tip);
  const base = new THREE.Object3D(); wrist.add(base);
  arms[side] = { root, yaw, pitch, elbow, wrist, blade, tip, base, sign, worldTip: [0, 0, 0], worldBase: [0, 0, 0] };
}
function frameArmKinematics() {
  const q = armRig.pose();
  for (const side of ['L', 'R']) {
    const a = arms[side], qq = q[side];
    a.yaw.rotation.y = qq.yaw;
    a.root.rotation.x = -0.35 + qq.pitch;
    a.elbow.rotation.y = qq.elbow * a.sign;
    a.wrist.rotation.x = qq.wrist;
  }
  scene.updateMatrixWorld();
  const WA = new THREE.Vector3(), WB = new THREE.Vector3();
  for (const side of ['L', 'R']) {
    arms[side].worldTip = WA.setFromMatrixPosition(arms[side].tip.matrixWorld).toArray();
    arms[side].worldBase = WB.setFromMatrixPosition(arms[side].base.matrixWorld).toArray();
  }
}

/* ---- fruit notes ----------------------------------------------------------- */
const fruitGeo = new THREE.IcosahedronGeometry(0.44, 2);
const stemMat = new THREE.MeshStandardMaterial({ color: 0x558b43, roughness: 0.7 });
const stemGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.22, 5);
const leafGeo = new THREE.SphereGeometry(1, 8, 5);
function spawnNote(lane) {
  const side = colorFor(lane); laneSpawns[lane]++;
  const material = new THREE.MeshStandardMaterial({ color: side === 'L' ? 0x27baca : 0xd63a69,
    emissive: COLORS[side], emissiveIntensity: 0.3, roughness: 0.28, metalness: 0.12 });
  const object = mesh(fruitGeo, material, scene, [LANES[lane], 1.6, SPAWN_Z]);
  mesh(stemGeo, stemMat, object, [0, 0.48, 0]);
  mesh(leafGeo, stemMat, object, [0.14, 0.51, 0], [0.2, 0.035, 0.1]);
  notes.push({ z: SPAWN_Z, side, lane, done: false, mesh: object, removedAt: Infinity }); spawned++;
}
const burstGeo = new THREE.TetrahedronGeometry(0.12);
const burstMats = { L: glow(COLORS.L), R: glow(COLORS.R) };
function burst(note) {
  for (let i = 0; i < 10; i++) {
    const object = mesh(burstGeo, burstMats[note.side], scene, [LANES[note.lane], 1.6, note.z]);
    particles.push({ mesh: object, life: 0.55,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 4, (Math.random() - 0.3) * 6) });
  }
}

/* ---- audio (spectator sound toggle only; never reaches gameplay) ---------- */
let audio = null, sound = false;
function blip(frequency) {
  if (!sound || !audio) return;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(0.055, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.16);
  osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.17);
}
$('sound').addEventListener('click', async () => {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    await audio.resume(); sound = !sound;
    $('sound').textContent = sound ? 'SOUND ON' : 'SOUND OFF';
    $('sound').setAttribute('aria-pressed', String(sound));
  } catch (error) { $('sound').textContent = 'AUDIO UNAVAILABLE'; }
});

/* ===========================================================================
 * ARM DRIVE — graph + trained motor map fetched from data/; discrete commands removed.
 * to live circuit activity (joints are the only effector). Simulation starts automatically once both assets load.
 * ==========================================================================*/
let brain = null, graph = null, motor = null;

fetch('data/connectome.json').then(r => { if (!r.ok) throw new Error('connectome HTTP ' + r.status); return r.json(); })
  .then(g => { graph = g; tryInit(); })
  .catch(error => fail(error));
fetch('data/motor-readout.json').then(r => { if (!r.ok) throw new Error('motor HTTP ' + r.status); return r.json(); })
  .then(m => { motor = m; tryInit(); })
  .catch(error => fail(error));

function tryInit() {
  if (!graph || !motor) return;
  try {
    brain = new Brain(graph, $('brain'));
    armRig = new ArmRig({ left: motor.left, right: motor.right });
  } catch (error) { fail('motor init: ' + error.message); return; }
  if (!brain || typeof brain.draw !== 'function') { fail('Missing circuit renderer'); return; }
  stats.controllerReady = true;
  $('status').textContent = 'AUTONOMOUS / LIVE';
  $('feedback').textContent = 'MOTOR MODEL LOADED · ARMS FROM JOINTS';
}

/* ===========================================================================
 * SWING + FIXED-STEP SIM
 * Collision requires actual blade contact; readout actions do not move joints.
 * ==========================================================================*/
// No canned swing: contact is scored below only when a blade tip physically
// reaches a note inside the slicing window. Arm pose comes from ArmRig (bridge).
function fixedStep() {
  simTime += SIM_DT; stats.ticks++;
  if (simTime >= nextBeat) { nextBeat += BEAT; spawnNote(spawnChoice()); }
  for (const note of notes) note.z += SPEED * SIM_DT;
  // senses -> circuit -> joints, one brain, arms come purely from joint motion.
  try {
    lastInputs = motorSenses(notes);
    brain.activity.fill(0);
    lastOutputs = Array.from(brain.step(lastInputs));
    armRig.update(SIM_DT, lastOutputs);
  } catch (error) { fail(error); }
  frameArmKinematics();
  const previousTip = lastTip;
  lastTip = Object.fromEntries(Object.entries(arms).map(([s, a]) => [s, { base: a.worldBase.slice(), tip: a.worldTip.slice() }]));

  // Physical contact: a note is sliced only when a blade tip truly reaches it.
  for (const note of notes) {
    if (note.done || Math.abs(note.z - HIT_Z) > WIN) continue;
    for (const side of ['L', 'R']) {
      if (note.side !== side) continue;
      if (!bladeCuts({previous: previousTip?.[side], current: lastTip[side],
        point: [LANES[note.lane], 1.6, note.z], radius: 0.62, dt: SIM_DT,
        bladeSide: side, noteSide: note.side})) continue;
      note.done = true; note.removedAt = simTime + 0.45;
      laneHits[note.lane]++; if(note.lane==='C')centerHits[side]++; stats.hits++; stats.swings++;
      stats.score += Math.abs(note.z - HIT_Z) < 0.85 ? 200 : 100;
      note.mesh.visible = false; burst(note); blip(side === 'L' ? 740 : 988);
      $('feedback').textContent = `${side === 'L' ? 'CYAN' : 'ROSE'} blade reached fruit`;
      break;
    }
  }
  for (const note of notes) {
    if (!note.done && note.z > PASS_Z) {
      note.done = true; note.removedAt = simTime + 0.45; stats.misses++;
      $('feedback').textContent = 'FRUIT PASSED UNREACHED';
    }
    if (note.done && simTime >= note.removedAt) { scene.remove(note.mesh); note.mesh.material.dispose(); }
  }
  notes = notes.filter(note => note.mesh.parent === scene);
  for (const particle of particles) {
    particle.life -= SIM_DT; particle.velocity.y -= 5 * SIM_DT;
    particle.mesh.position.addScaledVector(particle.velocity, SIM_DT);
    particle.mesh.rotation.x += 0.12; particle.mesh.scale.setScalar(Math.max(0, particle.life / 0.55));
    if (particle.life <= 0) scene.remove(particle.mesh);
  }
  particles = particles.filter(particle => particle.life > 0);
}
function render() {
  // Keep the body anchor fixed: only neural joints move the blades.
  for (const { pivot, sign } of wings) pivot.rotation.z = sign * (0.16 + Math.sin(simTime * 47) * 0.25);
  for (const side of ['L', 'C', 'R']) gates[side].material.opacity = 0.55;
  for (const note of notes) { note.mesh.position.z = note.z; note.mesh.rotation.y = simTime * 0.8; }
  roadLines.forEach((stripe, i) => { stripe.position.z = -58 + ((i * 3.4 + simTime * SPEED) % 62); });
  $('score').textContent = String(stats.score).padStart(6, '0');
  $('hits').textContent = stats.hits; $('misses').textContent = stats.misses;
  if (brain) { brain.draw(); updatePanels(brain, graph, armRig, lastOutputs, lastInputs, stats.swings); }
  const motor = armRig.telemetry();
  $('motor-values').textContent = ['Outputs: ' + motor.neural.map(v=>v.toFixed(2)).join(' '), ...['L','R'].flatMap(s=>Object.keys(motor.angles[s]).map(j=>`${s} ${j}: ${motor.targets[s][j].toFixed(2)} → ${motor.angles[s][j].toFixed(2)} rad`))].join('\n');
  $('last-swing').textContent = 'STRICT COLOR ⎯ CYAN L / ROSE R · NO KEYBOARD OUTPUT';
  renderer.render(scene, camera); stats.frames++;
}

let lastTime = null, accumulator = 0;
document.addEventListener('visibilitychange', () => { lastTime = null; accumulator = 0; });
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { lastTime = null; accumulator = 0; return; }
  const elapsed = lastTime === null ? 0 : Math.max(0, Math.min((now - lastTime) / 1000, 0.1));
  lastTime = now;
  try {
    if (brain && !stats.error) {
      accumulator += elapsed;
      while (accumulator + 1e-9 >= SIM_DT) { fixedStep(); accumulator -= SIM_DT; }
    }
    render();
  } catch (error) { fail(error); }
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
/* auto-start immediately — no start button, no human slicing input */
$('status').textContent = 'BOOTING MODEL…';
requestAnimationFrame(frame);