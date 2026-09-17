# Saber runtime snapshot

This folder is a self-contained snapshot of the local fruitfly-saber runtime.
`npm run build:live` copies it to `public/saber/`; no sibling directory,
training process, extra server, or remote asset host is required.

Routes: `/monitor.html` is the game picker; `/runner.html` is the original
runner; `/saber/index.html` is this experimental autonomous scene.

`integration.css` is loaded after Saber styles, aligns the flat night chrome,
and provides Project home / Change game navigation. Gameplay modules are
copied without changes. Licenses remain in ATTRIBUTION.md and vendor/.

The checkpoint is a snapshot, not automatically synchronized with background
training. The integration does not certify motor quality, biological realism,
or idle-rest behavior. Repetitive movement remains under investigation.
When importing another checkpoint, re-run gameplay verification separately
from site routing/layout tests. Runner benchmark figures do not apply here.
