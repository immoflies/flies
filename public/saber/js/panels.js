// Panels renderer: Brain Activity + Neural→Joint Motion (no keyboard/readout).
const $ = id => document.getElementById(id);
const IN = 8, OUT = 16;
function bar(v, min = -2.4, max = 2.4) { return Math.round(100 * Math.min(1, Math.max(0, (v - min) / (max - min)))); }

export function updatePanels(brain, graph, armRig, lastOutputs, lastInputs, _swings) {
  // --- brain activity canvas (80 modeled cells) is drawn by brain.draw() -----
  // --- sensing + joint motion canvas -----------------------------------------
  const cv = $('network'); if (!cv) return;
  const c = cv.getContext('2d'); const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H); c.font = '11px ui-monospace,monospace';
  for (let i = 0; i < IN; i++) {
    const v = lastInputs[i] ?? 0;
    const x = 46 + (i % 2) * 52, y = 20 + Math.floor(i / 2) * 22;
    c.fillStyle = '#3fd0dc'; c.fillRect(x - 24 * v, y, 24 * v, 10);
    c.fillStyle = '#5d6f66'; c.fillText('s' + i, x - 30, y + 9);
  }
  for (let i = 0; i < OUT; i++) {
    const v = lastOutputs[i] ?? 0;
    const x = 176 + Math.floor(i / 8) * 168 + 8, y = 20 + (i % 8) * 18;
    c.fillStyle = v > 0 ? '#e3f5e9' : '#8fd0a4';
    c.fillRect(x, y, bar(v) * 0.9, 8);
  }
  // joint targets vs actual, per arm
  const tm = armRig.telemetry();
  let row = 0;
  for (const side of ['L', 'R']) for (const j of ['yaw', 'pitch', 'elbow', 'wrist']) {
    const t = tm.targets[side][j], a = tm.angles[side][j];
    const x = 20 + row * 10, y = 150 + ((side === 'L' ? 0 : 2) + (['yaw', 'pitch', 'elbow', 'wrist'].indexOf(j)));
    const p1 = 1 + y * 22; row++;
  }
  let r = 0;
  for (const side of ['L', 'R']) for (const j of ['yaw', 'pitch', 'elbow', 'wrist']) {
    const t = tm.targets[side][j], a = tm.angles[side][j];
    const yo = 150 + r * 22; r++;
    const x = 20;
    c.fillStyle = side === 'L' ? '#3fd0dc' : '#ff6390';
    c.fillRect(x, yo, Math.max(2, 60 * (t + 1.2) / 2.4), 9);
    c.fillStyle = '#eef6f1';
    c.fillRect(x + 4, yo + 12, Math.max(2, 60 * (a + 1.2) / 2.4), 9);
    c.fillStyle = '#8fa6ff'; c.fillText(`${side}.${j} t=${t.toFixed(2)} a=${a.toFixed(2)}`, x + 66, yo + 21);
  }
  // summary text
  const el = $('activity-summary');
  if (el && graph?.nodes) {
    const active = (brain?.activity ?? new Float64Array(1)).reduce((n, v) => n + (Math.abs(v) > 0.05 ? 1 : 0), 0);
    el.textContent = `${active} / ${graph.nodes.length} modeled cells driving ${OUT} output features`;
  }
}