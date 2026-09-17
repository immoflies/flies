# Attribution (required)

This project reuses two external works. Their notices are preserved.

## 1. Connectome circuit data (from cobanov/flyjump)

The circuit graph (`src/data/connectome.json`) derives from
[cobanov/flyjump](https://github.com/cobanov/flyjump) by Mert Cobanov.
That repository's template is attribution-required source-available software.
Per its terms, keep this linked credit in the repository README and in any
web interface that uses the circuit:

> Built with [fly-connectome-template](https://github.com/cobanov/fly-connectome-template)
> by [Mert Cobanov](https://github.com/cobanov).

The underlying data is the **MaleCNS v1.0** connectome:

- Data creators: FlyEM / HHMI Janelia, University of Cambridge,
  MRC Laboratory of Molecular Biology, and Google Research.
- Dataset / project: https://male-cns.janelia.org/download/
- License: Creative Commons Attribution 4.0 International (CC BY 4.0).
  No endorsement of this project is implied.
- **80-cell graph** (32 visual inputs + 32 bridge interneurons + 16 descending
  readout cells; 1,296 directed edges, 26,029 contacts) — the shipped default.
  It is mined by rerunning the upstream selection logic
  (`scripts/build-connectome-250.py`, adapted from flyjump's `build-connectome.py`)
  against the same MaleCNS v1.0 source tables, verified against the upstream SHA-256
  digests of `annotations.feather`, `edges.feather`, `neurotransmitters.feather`.
  A larger 258-cell / 10,713-edge variant (210 bridge cells) was also mined for the
  comparison study archived in `docs/`; it is not the shipped default.
  Edge contact counts, sign assumptions, and leaky-tanh dynamics are unchanged
  engineering/modeling choices, not biological measurements.

## 2. Jurassic Runner game (from diegopacheco/ai-playground)

Vendored verbatim under the Unlicense; see
`vendor/jurassic-runner/VENDOR_NOTICE.md`.

## 3. Theme overlay (original to this project)

`public/theme.js` — the "Immortal Fruit Fly" hero, predator-fly sprites, and orchard
backdrop — is **original work by this project**, not part of Jurassic Runner and not
covered by the upstream Unlicense. It is applied as a runtime override so the vendored
`vendor/jurassic-runner/game.js` stays byte-for-byte unmodified. Remove
`public/theme.js` (and its one line in `scripts/build-live.mjs`) to get the unthemed
Jurassic Runner back with identical gameplay and results.

## 4. Brain atlas and visualization reference

`public/data/brain-atlas/` is downloaded from
[cobanov/flyjump](https://github.com/cobanov/flyjump/tree/main/public/data/brain-atlas).
MaleCNS v1.0 soma data: CC BY 4.0, credited to the data creators in §1.
The manifest preserves source and export SHA-256 digests. No data changes made.
The Canvas renderer follows the upstream BrainScene orthographic-fit approach.
It displays 124,289 optic/central/descending somata from 140,024 atlas entries;
VNC-associated and unclassified entries are excluded. This is soma anatomy, not
a complete brain surface or measured activity; only 80 circuit cells are modeled.
