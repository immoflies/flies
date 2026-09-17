import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import * as build from '../scripts/build-live.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('Vercel builds only the local static workbench', () => {
  assert.ok(existsSync(new URL('vercel.json', root)), 'static deployment config exists');
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.buildCommand, 'npm run build:live');
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.framework, null);
  assert.equal(config.installCommand, 'npm install --ignore-scripts --no-audit --no-fund');
  assert.equal(config.functions, undefined);
  assert.equal(config.rewrites, undefined);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['build:live'], 'node scripts/build-live.mjs');
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length);
});

test('upload exclusions retain every input needed by the remote build', () => {
  const ignored = read('.vercelignore').split('\n').filter(line => line && !line.startsWith('#'));
  for (const input of ['public', 'scripts', 'src', 'vendor', 'overlay', 'package.json']) {
    assert.ok(!ignored.includes(input) && !ignored.includes(input + '/'), `${input} must reach Vercel for build`);
  }
  assert.ok(ignored.includes('.git/'));
  assert.ok(ignored.includes('node_modules/'));
});

test('HTML renderer preserves game/panel hooks with the new hazard legend', () => {
  assert.equal(typeof build.renderHtml, 'function', 'HTML can be checked without rebuilding public');
  const html = build.renderHtml();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const required = ['game', 'overlay', 'overlay-title', 'overlay-text', 'start', 'score', 'time', 'action', 'status', 'cam', 'grab', 'pip', 'mute', 'fs', 'speed-range', 'speed-name', 'policy-network', 'keyboard-output', 'brain-scene'];
  for (const id of required) assert.ok(ids.includes(id), `preserve #${id}`);
  assert.equal(new Set(ids).size, ids.length, 'IDs are unique');
  for (const hazard of ['wooden wall', 'flying bird', 'broken road + pond']) assert.ok(html.includes(hazard));
  assert.match(html, /<h1[^>]*>IMMORTAL FRUIT FLIES<\/h1>/);
  assert.doesNotMatch(html, /<footer\b/);
  assert.match(read('ATTRIBUTION.md'), /CC BY 4\.0/);
  assert.match(read('ATTRIBUTION.md'), /Unlicense/);
});

test('HTML asset URLs and atlas payloads are local, relative and present', () => {
  const html = build.renderHtml();
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(refs, ['../favicon.png', '../style.css', '../audio.js', '../live.js', '../panels.js']);
  for (const ref of refs) {
    assert.ok(!/^(?:[a-z]+:|\/)/i.test(ref));
    // refs are relative to the page's own directory (e.g. ../favicon.png from
    // /runner/); normalize to a public/ path before asserting the file exists.
    const local = ref.replace(/^(?:\.\.\/)+/, '');
    assert.ok(existsSync(new URL(`public/${local}`, root)), ref);
  }
  const manifest = JSON.parse(read('public/data/brain-atlas/manifest.json'));
  for (const ref of [manifest.files.positions, manifest.files.groups]) {
    assert.ok(existsSync(new URL(`public/data/brain-atlas/${ref}`, root)), ref);
  }
  assert.match(read('public/panels.js'), /fetch\("\.\.\/data\/brain-atlas\/manifest.json"\)/);
});

test('Monitor chrome is flat, square, responsive and keeps dark canvas surfaces', () => {
  const css = read('public/style.css');
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\(|backdrop-filter|box-shadow/);
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.match(match[1], /^0(?:px)?$/);
  assert.match(css, /minmax\(0,/);
  assert.match(css, /max-width:\s*480px/);
  assert.match(css, /\.scene\s*\{[^}]*background:\s*var\(--canvas\)/);
  assert.match(css, /:focus-visible/);
});

test('page is link-free, dark, minimal and has a sound toggle', () => {
  const html = build.renderHtml();
  // No old-repository links or credits anywhere in the served page.
  for (const banned of ['github.com/diegopacheco', 'github.com/cobanov', 'ai-playground', 'fly-connectome-template', 'flyjump" href']) {
    assert.ok(!html.includes(banned), `served page must not contain: ${banned}`);
  }
  assert.ok(!html.includes('site-header'), 'no landing header/nav in the monitor page');
  assert.ok(html.includes('href="../"'), 'crumb links back to the project home');
  assert.ok(!html.includes('100-year-old'), 'brand tagline removed');
  assert.ok(html.includes('audio-toggle'), 'header sound toggle present');
  assert.match(html, /<meta name="color-scheme" content="dark"/);
  // Dark flat chrome in CSS.
  const css = read('public/style.css');
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /--bg:\s*#0b0e0c/);
  assert.match(css, /\.audio-btn/);
  assert.match(css, /\.crumb\s*\{/, 'breadcrumb link is styled (mono/muted), not a stray default link');
  assert.ok(!/(?:linear|radial)-gradient\(|backdrop-filter|box-shadow/.test(css), 'no gradients/glass/shadows');
  // The bundle mutes audio on load before any autoplay can begin.
  const bundle = build.assembleLive();
  assert.match(bundle, /Jungle\.toggle\(\)/, 'runtime mutes the audio engine at boot');
  assert.match(bundle, /audio-toggle/);
});

test('deployment instructions specify import settings without publishing', () => {
  assert.ok(existsSync(new URL('docs/deployment.md', root)));
  const doc = read('docs/deployment.md');
  for (const text of ['Other', '22.x', 'npm run build:live', 'public', 'No deployment', 'WebSocket', 'camera']) assert.ok(doc.includes(text), text);
});

test('exact live assembly parses without training or output writes', () => {
  const before = read('public/live.js');
  const source = build.assembleLive();
  assert.doesNotThrow(() => new Script(source));
  assert.equal(read('public/live.js'), before);
  assert.match(source, /runtime clock overlay/);
});
