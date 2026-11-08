// sf-BEACON Risk Classifier — PyTorch Lightning MLP trained on Nemotron embeddings of synthetic caller lines (see ml/).
// Runs here in TypeScript from exported weights (no Python at demo time). It is a THIRD opinion next to the keyword
// scan and Nemotron: it never triggers the 911 line itself — disagreements go to a human (urgent assistance queue).
import { existsSync, readFileSync } from "node:fs";

// Nemotron embedding model (open weights). 3.5-embed-8b (4096-d) works best; hosted 3.5 models take one input per request.
export const EMBED_MODEL = process.env.RISK_EMBED_MODEL || "nvidia/nemotron-3.5-embed-8b";
const EMBED_URL = "https://integrate.api.nvidia.com/v1/embeddings";

/** Nemotron embeddings for a batch of texts (hosted API, NVIDIA_API_KEY). */
// The hosted nemotron-3.5-embed-* models 500 on multi-input requests (Nov 2026) → send those one line at a time.
const SINGLE_INPUT = () => /3\.5-embed/.test(EMBED_MODEL);

export async function embed(texts: string[], timeoutMs = 15_000): Promise<number[][]> {
  if (texts.length > 1 && SINGLE_INPUT()) {
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += 8) {
      const part = await Promise.all(texts.slice(i, i + 8).map((t) => embedBatch([t], timeoutMs)));
      part.forEach((v, j) => (out[i + j] = v[0]));
    }
    return out;
  }
  return embedBatch(texts, timeoutMs);
}

async function embedBatch(texts: string[], timeoutMs: number): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: "query", encoding_format: "float" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    const body = (await res.text()).slice(0, 200);
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`embed ${res.status}: ${body}`);
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
}

interface Weights { labels: string[]; mean: Float32Array; std: Float32Array; layers: { W: Float32Array; b: Float32Array; out: number; in: number }[] }
let weights: Weights | null | undefined;
function load(): Weights | null {
  if (weights !== undefined) return weights;
  const manifest = new URL("../../ml/model/risk_classifier.json", import.meta.url);
  if (!existsSync(manifest)) return (weights = null);
  const m = JSON.parse(readFileSync(manifest, "utf8")) as { labels: string[]; dim: number; weights: string; layers: { out: number; in: number }[] };
  const buf = readFileSync(new URL(`../../ml/model/${m.weights}`, import.meta.url));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  let o = 0;
  const take = (n: number) => { const a = all.subarray(o, o + n); o += n; return a; };
  const mean = take(m.dim), std = take(m.dim);
  const layers = m.layers.map((l) => ({ ...l, W: take(l.out * l.in), b: take(l.out) }));
  return (weights = { labels: m.labels, mean, std, layers });
}

export const riskModelAvailable = () => Boolean(load());

/** Forward pass: standardize → (Linear → ReLU)* → Linear → softmax. */
export function predictFromEmbedding(x: number[]): Record<string, number> {
  const w = load();
  if (!w) throw new Error("risk model not trained (run npm run ml:train)");
  let h = Float32Array.from(x, (v, i) => (v - w.mean[i]) / (w.std[i] || 1));
  w.layers.forEach((layer, li) => {
    const out = new Float32Array(layer.out);
    for (let r = 0; r < layer.out; r++) {
      let s = layer.b[r]; const base = r * layer.in;
      for (let i = 0; i < layer.in; i++) s += layer.W[base + i] * h[i];
      out[r] = li < w.layers.length - 1 ? Math.max(0, s) : s;
    }
    h = out;
  });
  const m = Math.max(...h); const e = Array.from(h, (v) => Math.exp(v - m)); const z = e.reduce((a, b) => a + b, 0);
  return Object.fromEntries(w.labels.map((l, i) => [l, e[i] / z]));
}

export async function classifyRisk(text: string): Promise<{ label: string; p: number; probs: Record<string, number> } | null> {
  if (!riskModelAvailable() || !text.trim()) return null;
  const [v] = await embed([text]);
  const probs = predictFromEmbedding(v);
  const [label, p] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  return { label, p, probs };
}
