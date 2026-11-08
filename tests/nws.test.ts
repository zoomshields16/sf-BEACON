// NWS geometry handling (offline — no network).
import { test } from "node:test";
import assert from "node:assert/strict";
const { toMultiPolygon, alertGeometry } = await import("../src/services/nws.js");

const sq = (x: number) => [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]];

test("merges Polygon + MultiPolygon zones into one MultiPolygon", () => {
  const m = toMultiPolygon([{ type: "Polygon", coordinates: sq(0) }, { type: "MultiPolygon", coordinates: [sq(2), sq(4)] }, null]);
  assert.equal(m?.type, "MultiPolygon");
  assert.equal(m?.coordinates.length, 3);
});

test("no geometry at all → null (alert is skipped, not stored broken)", () => {
  assert.equal(toMultiPolygon([null, null]), null);
});

test("an alert that has its own polygon uses it directly (no zone fetch)", async () => {
  const g = await alertGeometry({ geometry: { type: "Polygon", coordinates: sq(0) }, properties: { affectedZones: ["https://example.invalid/zone"] } });
  assert.equal(g?.coordinates.length, 1);
});
