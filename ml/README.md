# sf-BEACON Risk Classifier (PyTorch Lightning on Nemotron embeddings)

A third, independent opinion on every caller turn of a **real** call — next to the keyword scan and Nemotron.
It **never triggers the 911 line**: if it sees a likely life threat (≥ 80 %) that the keywords and Nemotron missed,
the case goes to the **Urgent assistance** queue for a human. Every verdict is shown in the agent activity feed.

| Step | Command | What it does |
|---|---|---|
| 1 | `npm run ml:generate -- 10` | Nemotron (Brev H100) writes caller lines per class × disaster × speaking style; a second Nemotron pass re-labels each line and only agreements are kept → `data/calls.jsonl` |
| 2 | `npm run ml:embed` | Embeds every line with open-weight **nvidia/nemotron-3.5-embed-8b** (4096-d) |
| 3 | `npm run ml:train` | PyTorch Lightning MLP (4096 → 256 → 4; weights exported as float32 binary, 4 MB), class-weighted, early stopping, 70/15/15 stratified split → `model/risk_classifier.json` + `model/metrics.json` |
| 4 | `npm run ml:eval` | Out-of-distribution check on hand-written caller lines (not from the generator) |

Classes: `life_threat` · `urgent` (harm within ~12 h) · `routine` · `safe` — same definitions as the live call rules.
Inference runs in TypeScript from the exported weights (`src/agents/risk-model.ts`), so no Python is needed at demo time.

**Results (Sun 2026-11-08):** 1,177 synthetic lines · held-out test accuracy **91.0 %** · life-threat precision/recall **94.6 % / 94.6 %** ·
hand-written lines **96 %** (11/11 life threats caught, 1 false alarm at 62 % — below the review threshold).

Setup: `npm run ml:setup` (Python 3.12 venv with torch, lightning, scikit-learn).
