import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as build from '../scripts/build-live.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('repo + X nav links and the CZ tweet embed are present', () => {
  const html = build.renderLanding();
  for (const s of ['https://github.com/immoflies/flies', 'https://x.com/immoflies',
                   'https://x.com/cz_binance/status/2099713592903995839', 'WE MADE IT!']) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /aria-label="GitHub"/, 'GitHub icon link');
  assert.match(html, /aria-label="X \(@immoflies\)"/, 'X icon link');
  assert.match(html, /blockquote class="tweet-card"[^>]*cite="https:\/\/x\.com\/cz_binance\/status\/2099713592903995839"/, 'tweet is linked to the post');
});
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
