// Step 2 — Nemotron embeddings (open-weight nvidia/nemotron-3.5-embed-1b) for every caller line.
// Usage: npx tsx ml/embed.ts  → ml/data/X.f32 (float32 rows) + ml/data/meta.json (labels, texts)
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { embed, EMBED_MODEL } from "../src/agents/risk-model.js";

const rows = readFileSync("ml/data/calls.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vecs: number[][] = [];
for (let i = 0; i < rows.length; i += 32) {
  vecs.push(...(await embed(rows.slice(i, i + 32).map((r: any) => r.text), 30_000)));
  process.stdout.write(`\r${Math.min(i + 32, rows.length)}/${rows.length} embedded`);
}
const dim = vecs[0].length;
const X = new Float32Array(vecs.length * dim);
vecs.forEach((v, i) => X.set(v, i * dim));
writeFileSync("ml/data/X.f32", Buffer.from(X.buffer));
writeFileSync("ml/data/meta.json", JSON.stringify({ model: EMBED_MODEL, dim, n: vecs.length,
  labels: rows.map((r: any) => r.label), texts: rows.map((r: any) => r.text), styles: rows.map((r: any) => r.style) }));
console.log(`\nsaved ${vecs.length} × ${dim} embeddings`);
