import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as build from '../scripts/build-live.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('homepage teaches the project and links to the preserved monitor', () => {
  assert.equal(typeof build.renderLanding, 'function');
  const html = build.renderLanding();
  for (const text of ['id="hero"', 'id="circuit"', 'id="method"', 'id="results"', 'id="scope"', 'monitor/', 'Night', 'dimensionless', 'not the current checkpoint']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /src="(?:live|panels|audio)\.js"/);
  assert.doesNotMatch(html, /href="style\.css"/, 'landing is self-contained; no monitor stylesheet');
  assert.ok(html.includes('href="landing.css"'), 'landing loads only its own stylesheet');
  assert.match(build.renderHtml(), /href="\.\.\/style\.css"/, 'monitor still loads the monitor stylesheet');
  const landingCss = read('public/landing.css');
  assert.match(landingCss, /body\.landing\s*\{[^}]*margin:\s*0[^}]*font-family:\s*var\(--night-sans\)/, 'landing base styles are self-contained (no dependency on monitor style.css)');
  assert.doesNotMatch(html, /href="style\.css"/, 'landing must not load the monitor stylesheet');
  const graph = JSON.parse(read('src/data/connectome.json'));
  assert.equal([...html.matchAll(/class="circuit-node /g)].length, graph.nodes.length);
  assert.equal([...html.matchAll(/class="circuit-edge"/g)].length, graph.edges.length);
  const bench = JSON.parse(read('public/benchmarks/benchmark.json'));
  for (const row of bench.results) assert.ok(html.includes(row.meanElapsed.toFixed(2)), row.name);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const anchor of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor[1]));
});
