import { readFileSync } from 'node:fs';
const readJSON = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderLanding() {
  const graph = readJSON('src/data/connectome.json');
  const benchmark = readJSON('public/benchmarks/benchmark.json');
  const contacts = graph.edges.reduce((sum, edge) => sum + edge[2], 0);
  const roles = ['input', 'interneuron', 'output'];
  const counts = roles.map(role => graph.nodes.filter(n => n.role === role).length);
  const range = axis => {
    const values = graph.nodes.map(n => n.position[axis]);
    return [Math.min(...values), Math.max(...values)];
  };
  const [xmin, xmax] = range(0), [ymin, ymax] = range(1);
  const xy = graph.nodes.map(n => [50 + (n.position[0] - xmin) / (xmax - xmin) * 480, 50 + (n.position[1] - ymin) / (ymax - ymin) * 320]);
  const lines = graph.edges.map(([pre, post, weight]) => `<line class="circuit-edge" x1="${xy[pre][0].toFixed(1)}" y1="${xy[pre][1].toFixed(1)}" x2="${xy[post][0].toFixed(1)}" y2="${xy[post][1].toFixed(1)}"><title>${escape(graph.nodes[pre].type)} → ${escape(graph.nodes[post].type)} · ${weight} contacts</title></line>`).join('');
  const nodes = graph.nodes.map((n, i) => `<circle class="circuit-node ${n.role}" cx="${xy[i][0].toFixed(1)}" cy="${xy[i][1].toFixed(1)}" r="${n.role === 'output' ? 5 : 3.5}"><title>${escape(n.type)} · ID ${n.id} · ${escape(n.role)} · ${escape(n.nt)}</title></circle>`).join('');
  const names = ['Trained readout', 'Circuit silenced', 'Untrained readout', 'Idle / NOOP', 'Random actions'];
  const bars = benchmark.results.map((r, i) => `<div class="benchmark-row"><span>${names[i]}</span><div class="bar-track"><div class="bar ${i === 0 ? 'trained' : ''}" style="width:${(r.meanElapsed / 20 * 100).toFixed(2)}%"></div></div><strong>${r.meanElapsed.toFixed(2)} <small>s</small></strong></div>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="IMMORTAL FRUIT FLIES \u00b7 $FLIES \u2014 two browser games played by connectome-driven fly agents. Connectome wiring, learned readouts, and the reflex science behind the toys.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="IMMORTAL FRUIT FLIES · $FLIES">
<meta property="og:title" content="IMMORTAL FRUIT FLIES · $FLIES">
<meta property="og:description" content="Fruit Fly Brain Experiment! — Games played by connectome-driven fruit-fly agents — plus BRAINVIEW, the whole MaleCNS brain in 3D">
<meta property="og:url" content="https://immoflies.com/">
<meta property="og:image" content="https://immoflies.com/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="IMMORTAL FRUIT FLIES · $FLIES">
<meta name="twitter:description" content="Fruit Fly Brain Experiment! — Games played by connectome-driven fruit-fly agents — plus BRAINVIEW, the whole MaleCNS brain in 3D">
<meta name="twitter:image" content="https://immoflies.com/og.png">
<title>IMMORTAL FRUIT FLIES \u00b7 $FLIES</title>
<link rel="icon" href="favicon.png" type="image/png">
<link rel="stylesheet" href="landing.css">
</head>
<body class="landing">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header shell">
  <a class="wordmark" href="./" aria-label="IMMORTAL FRUIT FLIES home"><span class="brand-mark" aria-hidden="true">$FLIES</span> IMMORTAL FRUIT FLIES</a>
  <nav aria-label="Main navigation"><a href="#science">Reflex</a><a href="#games">The flies</a><a href="#onchain">On-chain</a><a href="#results">Evidence</a><a class="nav-icon" href="https://github.com/immoflies/flies" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a><a class="nav-icon" href="https://x.com/immoflies" target="_blank" rel="noopener noreferrer" aria-label="X (@immoflies)"><svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></a><a class="nav-launch" href="monitor/">Open monitor <span aria-hidden="true">↗</span></a></nav>
</header>
<main id="main">
<section class="hero shell" id="hero" aria-labelledby="hero-title">
  <div class="hero-copy">
    <h1 id="hero-title">Small circuit.<br>Real connections.<br><span>Learned decisions.</span></h1>
    <p class="hero-description">Two browser games are played by connectome-driven fly agents. You watch the modeled circuit choose its actions. FLYINGFLIES dodges looming threats in an endless three-lane runner; SABER4FLIES slices fruit by measured joint motion. Real connectome data shapes the signal; task-specific readouts turn it into game actions.</p>
    <div class="hero-actions"><a class="button primary" href="monitor/">Choose a game <span aria-hidden="true">↗</span></a><a class="button" href="brainview/">BRAINVIEW <span aria-hidden="true">↗</span></a><a class="text-link" href="#method">Read the experiment <span aria-hidden="true">↓</span></a></div>
    <p class="hero-note">Drosophila melanogaster \u00b7 MaleCNS v1.0 subset<br>Runs in your browser. No camera or account required.<br>$FLIES \u00b7 token details are provisional.</p>
  </div>
  <figure class="circuit-figure" id="circuit">
    <div class="figure-label"><span>01 / CIRCUIT MAP</span><span>STATIC · XY PROJECTION</span></div>
    <svg class="circuit-map" viewBox="0 0 580 420" role="img" aria-labelledby="graph-title graph-desc">
      <title id="graph-title">The measured ${graph.nodes.length}-cell circuit</title><desc id="graph-desc">${counts[0]} input cells, ${counts[1]} bridge interneurons and ${counts[2]} output cells, with ${graph.edges.length.toLocaleString('en-US')} directed connections. Node locations use measured x and y coordinates, scaled independently to fit. Lines indicate connections, not live signals.</desc>
      <path class="crosshair" d="M290 8v14m0 376v14M8 210h14m536 0h14"/>
      <g>${lines}</g><g>${nodes}</g>
    </svg>
    <figcaption><div class="graph-legend"><span><i class="input-key"></i>${counts[0]} inputs</span><span><i class="bridge-key"></i>${counts[1]} bridges</span><span><i class="output-key"></i>${counts[2]} outputs</span></div><p>Actual circuit nodes and edges; not a whole-brain simulation. Hover a node for its cell type. Geometry is static; live activity is in the monitor.</p></figcaption>
  </figure>
</section>
<section class="madeit shell" id="madeit" aria-labelledby="madeit-title">
  <div class="section-intro"><p class="eyebrow">FROM X</p><h2 id="madeit-title">WE MADE IT!</h2><p>Our take on immortal fruit flies: two experimental games. The post below is context, not an endorsement of this project.</p></div>
  <blockquote class="tweet-card" cite="https://x.com/cz_binance/status/2099713592903995839">
    <div class="tweet-head"><span class="tweet-monogram" aria-hidden="true">CZ</span><div class="tweet-author"><strong>CZ 🔶 BNB</strong><span>@cz_binance</span></div><svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></div>
    <p class="tweet-body"><a href="https://x.com/cz_binance/status/2099713592903995839" target="_blank" rel="noopener noreferrer">Would be cool to see someone make &quot;immortal fruit flies&quot; on BNB Chain.</a></p>
    <p class="tweet-src">More background here: <a href="https://t.co/lve6DMLzxX" target="_blank" rel="noopener noreferrer">https://t.co/lve6DMLzxX</a></p>
    <footer class="tweet-meta"><a href="https://x.com/cz_binance/status/2099713592903995839" target="_blank" rel="noopener noreferrer">September 15, 2026</a><span>&nbsp;·&nbsp;from @cz_binance</span></footer>
  </blockquote>
</section>
<div class="spec-strip shell" aria-label="Circuit specifications">
  <div><strong>${graph.nodes.length}</strong><span>MODELED CELLS</span></div><div><strong>${graph.edges.length.toLocaleString('en-US')}</strong><span>DIRECTED EDGES</span></div><div><strong>${contacts.toLocaleString('en-US')}</strong><span>SYNAPTIC CONTACTS</span></div><div><strong>269</strong><span>RUNNER PARAMETERS</span></div>
</div>
<section class="section shell" id="science" aria-labelledby="science-title">
  <div class="section-intro"><p class="eyebrow">REFLEX / BIOLOGY TO GAMEPLAY</p><h2 id="science-title">An approaching threat.<br>A circuit. A response.</h2><p>Games make a sensorimotor loop inspectable: observe an approaching object, transform the signal, move, then observe the changed world. That is a useful experimental analogy—not proof that these controllers reproduce a living fly’s reflex.</p></div>
  <div class="scope-details">
    <details open><summary>What biological looming detection actually means</summary><p>In Drosophila, LPLC2 visual neurons respond selectively to outward, expanding motion and provide excitatory input to the giant-fiber escape pathway.<a href="https://pubmed.ncbi.nlm.nih.gov/29120418">[2]</a> Our games instead supply engineered proximity and lane signals directly from game state. They do not simulate a retina, reconstruct visual motion from pixels, or establish that this selected circuit reproduces the LPLC2 pathway.</p></details>
    <details open><summary>Measured wiring is not a complete simulated brain</summary><p>The published hemibrain reconstruction contains around 25,000 neurons and about 20 million chemical synapses.<a href="https://elifesciences.org/articles/57443">[1]</a> That is scientific context, not the dataset size running here: these games use a selected MaleCNS circuit of ${graph.nodes.length} cells and ${graph.edges.length.toLocaleString('en-US')} directed edges. The anatomy supplies connectivity; input encoding, normalization and activation dynamics are engineered.</p></details>
    <details open><summary>Two different tests of the same control-loop idea</summary><p>The runner converts circuit activity into five discrete action scores: stay neutral, move left, move right, jump or duck. SABER4FLIES instead maps activity into arm-joint targets; damped joint motion places a blade in the scene. A matching-color fruit must overlap a moving blade contact point to score. Neither task demonstrates biological intelligence or natural fruit-fly limb mechanics.</p></details>
    <details open><summary>What a convincing reflex experiment would measure</summary><p>Useful next measurements include response delay from a defined stimulus onset, success by lane and color, idle motion, and sensitivity to circuit silencing or shuffled wiring. These are proposed controls, not completed results. Game clock frequency is not a measured biological reaction time. Saber’s idle-rest and right-center reach acceptance checks remain unresolved.</p></details>
  </div>
  <p class="hero-note">Sources: <a href="https://elifesciences.org/articles/57443">[1] Scheffer et al., A connectome and analysis of the adult Drosophila central brain</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/29120418">[2] Ultra-selective looming detection from radial motion opponency</a>. These studies do not validate or endorse the games or $FLIES.</p>
</section>
<section class="section shell method" id="method" aria-labelledby="method-title">
  <div class="section-intro"><p class="eyebrow">02 / RUNNER EXPERIMENT</p><h2 id="method-title">The wiring is fixed.<br>The readout learns.</h2><p>This is a control experiment, not a digital animal. The question is whether a small model built from measured neural connections can provide useful signals for a learned game controller.</p></div>
  <div class="method-steps">
    <article><span class="step-number">01</span><div><h3>Observe the course</h3><p>Eight engineered values describe danger proximity in each lane, the fly’s lateral position, the current lane’s hazard type, and jump height. The controller reads game state, not pixels.</p><code>8 observations → 32 input cells</code></div></article>
    <article><span class="step-number">02</span><div><h3>Pass through the circuit</h3><p>Signed, normalized contact weights propagate activity through the fixed MaleCNS subset. Three leaky-tanh iterations produce dimensionless activity values—not biological spikes or voltages.</p><code>32 inputs + 32 bridges + 16 outputs</code></div></article>
    <article><span class="step-number">03</span><div><h3>Choose an action</h3><p>A small readout trained with the cross-entropy method maps 16 circuit outputs through 12 hidden units to five action scores. The largest score wins; the circuit weights themselves are not trained.</p><code>16 → 12 → 5 · NOOP / LEFT / RIGHT / JUMP / DUCK</code></div></article>
    <article><span class="step-number">04</span><div><h3>Close the loop</h3><p>The selected action drives the runner, changing the next observation. The game advances at a fixed 60 Hz, with one agent decision every two simulation ticks. Neutral, jump and duck retain lateral position.</p><code>60 Hz simulation · 30 Hz decisions</code></div></article>
  </div>
</section>
<section class="monitor-guide section" aria-labelledby="guide-title"><div class="shell">
  <div class="section-heading"><div><p class="eyebrow">03 / INSIDE THE RUNNER MONITOR</p><h2 id="guide-title">Follow a decision,<br>not just a score.</h2></div><a class="button" href="monitor/">Enter the live experiment <span aria-hidden="true">↗</span></a></div>
  <div class="guide-grid">
    <div class="signal-path" aria-label="Signal flow"><span>GAME STATE</span><b aria-hidden="true">↓</b><span>FIXED CIRCUIT</span><b aria-hidden="true">↓</b><span>TRAINED READOUT</span><b aria-hidden="true">↓</b><span>KEYBOARD ACTION</span><p>Action changes the next game state.</p></div>
    <dl class="panel-guide"><div><dt>01 / Game</dt><dd>The fly dodges wooden walls, ducks under birds and jumps over a broken road with a pond. The agent auto-plays; arrow keys, space and down let you take over.</dd></div><div><dt>02 / Decision network</dt><dd>The 16 → 12 → 5 graph shows the learned readout, not the biological wiring above. Connections encode signed contributions, and the chosen action is highlighted.</dd></div><div><dt>03 / Keyboard output</dt><dd>See which key the controller holds. NOOP means no new key command, not necessarily no movement.</dd></div><div><dt>04 / Brain activity</dt><dd>Bright circuit cells show simulated activity over a measured soma atlas. The background anatomy is for spatial context; those background cells are not simulated. Drag to rotate, scroll to zoom.</dd></div></dl>
  </div>
</div></section>
<section class="section shell" id="games" aria-labelledby="games-title">
  <div class="section-intro"><p class="eyebrow">TWO GAMES / ONE CONNECTED CIRCUIT</p><h2 id="games-title">You watch.<br>The fly plays.</h2><p>Both games boot straight to an autonomous fruit-fly brain. No keyboard input is required — the circuit is the player. Each page runs only itself.</p></div>
  <div class="picker-grid">
    <a class="game-card" href="runner/" aria-label="Open FLYINGFLIES live monitor">
      <span class="card-tag">GAME 01 \u00b7 RUNNER \u00b7 Experimental</span>
      <h2>FLYINGFLIES</h2>
      <p>Endless three-lane runner. The readout-trained fly dodges wooden walls, ducks birds and jumps ponds on its own; the monitor shows the exact key it chooses as it flies.</p>
    </a>
    <a class="game-card" href="saber/" aria-label="Open SABER4FLIES (experimental)">
      <span class="card-tag">GAME 02 \u00b7 SABER4FLIES \u00b7 Experimental</span>
      <h2>SABER4FLIES</h2>
      <p>Autonomous saber scene. Cyan left arm and rose right arm slice matching fruit by measured joint motion \u2014 no keyboard output. Experimental; motion quality still under investigation.</p>
    </a>
  </div>
</section>
<section class="section shell evidence" id="results" aria-labelledby="results-title">
  <div class="section-intro"><p class="eyebrow">05 / EVIDENCE, WITH CONTEXT</p><h2 id="results-title">Measure the behavior.<br>Keep the caveats.</h2><p>The archived comparison tests a trained readout against silencing, untrained weights and simple action baselines.</p><p class="archive-note">Historical benchmark: previous recenter controller, <strong>not the current checkpoint</strong>. These controls have not been rerun for the current lane-retention system.</p></div>
  <figure class="benchmark"><div class="figure-label"><span>MEAN SURVIVAL / SECONDS</span><span>${benchmark.cfg.nTest} HELD-OUT SEEDS</span></div>${bars}<div class="chart-axis"><span>0 s</span><span>10 s</span><span>20 s</span></div><figcaption>${benchmark.cfg.cap} s cap · no condition completed a course. Static results from the archived benchmark; not live telemetry. <a href="benchmarks/benchmark.json">View source data ↗</a></figcaption></figure>
</section>
<section class="section shell scope" id="scope" aria-labelledby="scope-title"><div><p class="eyebrow">06 / WHAT THIS DOES — AND DOESN’T — MEAN</p><h2 id="scope-title">A model of a circuit.<br>Not a claim of a mind.</h2></div><div class="scope-details">
<details open><summary>Measured anatomy, modeled dynamics</summary><p>The source connections come from the MaleCNS v1.0 dataset. Cell selection, observation encoding, weight normalization and rate dynamics are engineering choices. This is an 80-cell subset, not a simulation of the whole fruit fly.</p></details>
<details open><summary>Dependence is not biological superiority</summary><p>The historical silencing control shows that the learned policy uses circuit activity. It does not prove the measured topology is better than another graph, establish animal-like behavior, or demonstrate consciousness.</p></details>
<details><summary>Training is not happening in your browser</summary><p>The monitor loads a saved checkpoint. Offline training adjusts 269 readout parameters using survival and action-coverage objectives. Browser play evaluates that fixed policy; it does not learn from your keystrokes.</p></details>
<details><summary>Reproducible, local, inspectable</summary><p>The game uses a seeded headless adapter for repeatable tests. The live page uses a fixed simulation clock. Audio starts muted. Game assets, circuit data and the checkpoint are served locally, without a backend.</p></details>
</div></section>
<section class="section shell onchain" id="onchain" aria-labelledby="onchain-title">
  <div class="section-intro"><p class="eyebrow">ON-CHAIN \u00b7 $FLIES</p><h2 id="onchain-title">Project token details.</h2><p>$FLIES is the ticker. The fields here are provisional and informational\u2014not an offer, and not financial advice.</p></div>
  <dl class="token-card">
    <div class="token-name"><span><dt>NAME</dt><dd>IMMORTAL FRUIT FLIES</dd></span><span class="ticker-cell"><dt>TICKER</dt><dd>$FLIES</dd></span></div>
    <div><dt>PAIRED</dt><dd>GOOGLB</dd></div>
    <div><dt>CONTRACT</dt><dd><code>0x1b96348a12299a5410642f3161a1525977707777</code></dd></div>
    <div><dt>CREATOR TAX</dt><dd>0.6%</dd></div>
    <div><dt>DIVIDEN</dt><dd>0.4%</dd><small>Rewards to Holders</small></div>
  </dl>
</section>
<section class="disclaimer shell" id="disclaimer" aria-labelledby="disclaimer-title">
  <h2 id="disclaimer-title">Not advice. Not verified. Read it yourself.</h2>
  <p>Nothing on this page is financial or legal advice.  These are an experiment, not a validated result: the runner\u2019s benchmark is an archived control, and SABER4FLIES has an unresolved motor acceptance gate \u2014 the arms can still drift at idle and right-center reach is unreliable.</p>
</section>
<section class="closing shell"><p class="eyebrow">THE FLIES PLAY THE GAMES.</p><h2>Watch connections become actions.</h2><a class="button primary" href="monitor/">Open the monitor <span aria-hidden="true">↗</span></a></section>
</main>
<footer class="site-footer shell"><span>IMMORTAL FRUIT FLIES · $FLIES / EXPERIMENT 001</span><span>Night theme · browser-native</span><a href="#hero">Back to top ↑</a></footer>
</body></html>`;
}
