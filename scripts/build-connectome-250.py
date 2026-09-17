"""Grow the bounded MaleCNS circuit to ~250 cells (bridge/interneuron layer only).

Adapted from cobanov/flyjump `scripts/build-connectome.py` (MIT; attribution
kept in ATTRIBUTION.md). The readout (16 descending cells) and the 32 visual
inputs are selected EXACTLY as upstream; only the two-hop bridge/interneuron
budget is raised from 32 to BRIDGES, so the trained 16->12->5 readout transfers
unchanged (no retraining). Selection uses anatomy only, never game outcomes.
Requires pyarrow/numpy; source feathers in the DATA_DIR (see README).
"""
from pathlib import Path
import json, hashlib, sys
import numpy as np
import pyarrow.feather as feather

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/hermes/malecns-src")
BRIDGES = int(sys.argv[2]) if len(sys.argv) > 2 else 210
# Optional 3rd arg: write ONLY the graph to this path (no manifest/public copies).
# Used to regenerate the 80-cell baseline (BRIDGES=32) for the latency comparison.
OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else None

expected = {
    "annotations": "2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2",
    "edges": "e35da783d1c686b2b58b3b87cd6a403ae43bfcfba8bff28e08ef752c1a56afc1",
    "neurotransmitters": "95c9289220663abeb3409f3ad9e5a7f8a53f8093f5139d15502cd08da8879621",
}
for name, digest in expected.items():
    p = DATA / f"{name}.feather"
    if not p.exists():
        raise SystemExit(f"missing {p}")
    if hashlib.file_digest(p.open("rb"), "sha256").hexdigest() != digest:
        raise SystemExit(f"checksum mismatch: {name}")

rows = feather.read_table(DATA / "annotations.feather", columns=["bodyId", "type", "superclass", "somaLocation"]).to_pylist()
ann = {r["bodyId"]: r for r in rows if r["somaLocation"]}
e = feather.read_table(DATA / "edges.feather")
pre = e["body_pre"].to_numpy(); post = e["body_post"].to_numpy(); weight = e["weight"].to_numpy()
nt = {r["body"]: r["consensus_nt"] for r in feather.read_table(DATA / "neurotransmitters.feather", columns=["body", "consensus_nt"]).to_pylist()}

types = ["LC4", "LC11", "LC9", "LC15", "LC16", "LC17", "LC21", "LPLC2"]
dn = np.array([i for i, r in ann.items() if r["superclass"] == "descending_neuron"])
md = np.isin(post, dn)
inputs = []; targets = []
for channel, typ in enumerate(types):
    ids = np.array([i for i, r in ann.items() if r["type"] == typ])
    ix = np.flatnonzero(np.isin(pre, ids) & md)
    strength = {int(i): int(weight[ix[pre[ix] == i]].sum()) for i in np.unique(pre[ix])}
    chosen = sorted(strength, key=lambda i: (-strength[i], i))[:4]
    if len(chosen) < 4:
        raise SystemExit(typ)
    inputs.extend((i, channel) for i in chosen)
    jx = ix[np.isin(pre[ix], chosen)]
    ranks = {int(i): int(weight[jx[post[jx] == i]].sum()) for i in np.unique(post[jx])}
    targets.extend(sorted(ranks, key=lambda i: (-ranks[i], i))[:2])
selected_inputs = [i for i, c in inputs]
ix = np.flatnonzero(np.isin(pre, selected_inputs) & md)
strength = {int(i): int(weight[ix[post[ix] == i]].sum()) for i in np.unique(post[ix])}
targets = list(dict.fromkeys(targets))
for i in sorted(strength, key=lambda i: (-strength[i], i)):
    if len(targets) >= 16:
        break
    if i not in targets:
        targets.append(i)

im = np.isin(pre, selected_inputs); om = np.isin(post, targets)
u, inv = np.unique(post[im], return_inverse=True); incoming = dict(zip(u, np.bincount(inv, weights=weight[im])))
u, inv = np.unique(pre[om], return_inverse=True); outgoing = dict(zip(u, np.bincount(inv, weights=weight[om])))
bridges = sorted((int(i) for i in incoming.keys() & outgoing.keys() if i in ann and i not in selected_inputs + targets),
                 key=lambda i: (-min(incoming[i], outgoing[i]), i))[:BRIDGES]

ids = sorted(set(selected_inputs + targets + bridges)); idx = {i: j for j, i in enumerate(ids)}
mask = np.isin(pre, ids) & np.isin(post, ids)
edges = sorted([[idx[int(a)], idx[int(b)], int(w)] for a, b, w in zip(pre[mask], post[mask], weight[mask])])
signs = {"acetylcholine": 1, "gaba": -1, "glutamate": -1}
graph = {
    "version": "malecns-dino-circuit-v2-250",
    "nodes": [{"id": i, "type": ann[i]["type"], "position": ann[i]["somaLocation"], "nt": nt.get(i),
               "sign": signs.get(nt.get(i), 0),
               "role": "input" if i in selected_inputs else "output" if i in targets else "interneuron"}
              for i in ids],
    "edges": edges,
    "inputs": [[idx[i], c] for i, c in inputs],
    "outputs": [idx[i] for i in targets],
    "channels": types,
}
graph_json = json.dumps(graph, separators=(",", ":")) + "\n"
if OUT is not None:
    OUT.write_text(graph_json)
    print(json.dumps({"nodes": len(ids), "edges": len(edges), "bridgeBudget": BRIDGES,
                      "synapticContacts": sum(x[2] for x in edges), "out": str(OUT)}, indent=2))
    raise SystemExit(0)
out = ROOT / "src/data/connectome.json"
out.write_text(graph_json)
(ROOT / "public/data/connectome").mkdir(exist_ok=True)
(ROOT / "public/data/connectome/graph.json").write_bytes(out.read_bytes())
manifest = {
    "dataset": "FlyEM MaleCNS v1.0, min confidence 0.5",
    "license": "CC BY 4.0",
    "source": "https://male-cns.janelia.org/download/",
    "nodes": len(ids), "edges": len(edges), "synapticContacts": sum(x[2] for x in edges),
    "inputCells": len(inputs), "readoutCells": len(targets), "bridgeCells": len(bridges),
    "bridgeBudget": BRIDGES,
    "graphSha256": hashlib.sha256(out.read_bytes()).hexdigest(),
    "sources": {p: digest for p, digest in expected.items()},
    "selection": (f"{len(selected_inputs)} visual cells (4 per each of 8 named types) by direct DN contact rank; "
                  f"union of top-2 DN targets per type, filled to 16 by contact rank; top {BRIDGES} two-hop bridge "
                  f"cells by minimum incoming/outgoing contact strength; all measured internal directed edges retained. "
                  f"Ties by body ID. Readout selection identical to v1 (no retrain needed). No game outcomes used."),
    "assumptions": ("Engineered input injection; simplified signed, normalized, leaky tanh rate units. "
                    "Acetylcholine +1, GABA/glutamate -1; unknown/modulatory 0. Not a physiological or whole-brain model."),
}
(ROOT / "public/data/connectome/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
print("readout (outputs):", [(ann[i]["type"], i) for i in targets])