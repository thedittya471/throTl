import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTimeline } from '../../lib/timeline.ts';

test('timeline preserves gaps and scales allowed/rejected bars using the same request-count axis', () => {
  const chart = buildTimeline([
    { elapsedMs: 0, allowed: 3, rejected: 1 }, { elapsedMs: 2_000, allowed: 0, rejected: 2 },
  ]);
  assert.equal(chart.maxCount, 4);
  assert.equal(chart.endMs, 3_000);
  assert.equal(chart.bars[0]!.allowedHeight, 105);
  assert.equal(chart.bars[0]!.rejectedHeight, 35);
  assert.ok(chart.bars[1]!.x - chart.bars[0]!.x > chart.bars[0]!.width * 1.9);
});

test('empty and zero-count timelines have finite scales', () => {
  for (const points of [[], [{ elapsedMs: 10_000, allowed: 0, rejected: 0 }]]) {
    const chart = buildTimeline(points);
    assert.equal(chart.maxCount, 1);
    assert.ok(Number.isFinite(chart.endMs));
    assert.ok(chart.bars.every((bar) => Number.isFinite(bar.width)));
  }
});
