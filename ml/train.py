"""Step 3 — train the BEACON Risk Classifier with PyTorch Lightning on Nemotron embeddings.

  ml/.venv/bin/python ml/train.py   → ml/model/risk_classifier.json (weights for the TypeScript runtime) + metrics.json

Classes: life_threat / urgent / routine / safe. The model is a third opinion in live calls; it never triggers 911 alone.
"""
import json
import pathlib

import lightning as L
import numpy as np
import torch
import torch.nn as nn
from lightning.pytorch.callbacks import EarlyStopping
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

ROOT = pathlib.Path(__file__).parent
meta = json.loads((ROOT / "data/meta.json").read_text())
X = np.fromfile(ROOT / "data/X.f32", dtype=np.float32).reshape(meta["n"], meta["dim"])
LABELS = ["life_threat", "urgent", "routine", "safe"]
y = np.array([LABELS.index(l) for l in meta["labels"]])

L.seed_everything(42, workers=True)
idx = np.arange(len(y))
tr, te = train_test_split(idx, test_size=0.15, stratify=y, random_state=42)
tr, va = train_test_split(tr, test_size=0.15 / 0.85, stratify=y[tr], random_state=42)
mean, std = X[tr].mean(0), X[tr].std(0) + 1e-6


def norm(a):
    return torch.tensor((a - mean) / std, dtype=torch.float32)


def loader(ids, shuffle):
    ds = torch.utils.data.TensorDataset(norm(X[ids]), torch.tensor(y[ids]))
    return torch.utils.data.DataLoader(ds, batch_size=64, shuffle=shuffle)


class RiskClassifier(L.LightningModule):
    def __init__(self, dim, hidden=256, classes=4, class_weights=None):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(dim, hidden), nn.ReLU(), nn.Dropout(0.3), nn.Linear(hidden, classes))
        self.loss = nn.CrossEntropyLoss(weight=class_weights)

    def forward(self, x):
        return self.net(x)

    def _step(self, batch, name):
        x, t = batch
        out = self(x)
        loss = self.loss(out, t)
        self.log(f"{name}_loss", loss, prog_bar=True)
        self.log(f"{name}_acc", (out.argmax(1) == t).float().mean(), prog_bar=True)
        return loss

    def training_step(self, b, _):
        return self._step(b, "train")

    def validation_step(self, b, _):
        self._step(b, "val")

    def configure_optimizers(self):
        return torch.optim.AdamW(self.parameters(), lr=1e-3, weight_decay=1e-3)


counts = np.bincount(y[tr], minlength=4)
model = RiskClassifier(meta["dim"], class_weights=torch.tensor(len(tr) / (4 * counts), dtype=torch.float32))
trainer = L.Trainer(max_epochs=80, accelerator="cpu", deterministic=True, logger=False, enable_checkpointing=False,
                    enable_model_summary=False, enable_progress_bar=False,
                    callbacks=[EarlyStopping("val_loss", patience=8)])
trainer.fit(model, loader(tr, True), loader(va, False))

model.eval()
with torch.no_grad():
    pred = model(norm(X[te])).argmax(1).numpy()
report = classification_report(y[te], pred, target_names=LABELS, output_dict=True, zero_division=0)
cm = confusion_matrix(y[te], pred, labels=range(4)).tolist()
print(classification_report(y[te], pred, target_names=LABELS, digits=3, zero_division=0))
print("confusion (rows = true, cols = predicted):", LABELS)
for name, row in zip(LABELS, cm):
    print(f"  {name:12s} {row}")

# Export for the TypeScript runtime (src/agents/risk-model.ts): standardize → Linear → ReLU → Linear → softmax.
# Weights go to a compact float32 binary; the JSON manifest describes the layout.
lin = [m for m in model.net if isinstance(m, nn.Linear)]
arrays = [mean.astype(np.float32), std.astype(np.float32)]
layers = []
for l in lin:
    W, b = l.weight.detach().numpy().astype(np.float32), l.bias.detach().numpy().astype(np.float32)
    layers.append({"out": W.shape[0], "in": W.shape[1]})
    arrays += [W.ravel(), b]
out = {
    "labels": LABELS, "embed_model": meta["model"], "dim": int(meta["dim"]), "layers": layers, "weights": "risk_classifier.f32",
    "metrics": {
        "test_accuracy": report["accuracy"], "life_threat_recall": report["life_threat"]["recall"],
        "life_threat_precision": report["life_threat"]["precision"], "per_class": {k: report[k] for k in LABELS},
        "confusion": cm, "n_train": len(tr), "n_val": len(va), "n_test": len(te), "epochs": trainer.current_epoch,
    },
}
(ROOT / "model").mkdir(exist_ok=True)
np.concatenate(arrays).astype(np.float32).tofile(ROOT / "model/risk_classifier.f32")
(ROOT / "model/risk_classifier.json").write_text(json.dumps(out))
(ROOT / "model/metrics.json").write_text(json.dumps(out["metrics"], indent=2))
print(f"\nsaved ml/model/risk_classifier.json  (test acc {report['accuracy']:.3f}, "
      f"life-threat recall {report['life_threat']['recall']:.3f}, epochs {trainer.current_epoch})")
