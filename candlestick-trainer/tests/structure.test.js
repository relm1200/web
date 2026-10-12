// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/patterns.js');
const S = require('../js/structure.js');

const k = (o, h, l, c) => ({ o, h, l, c });

// Candles from a list of [high, low] pairs.
const fromHL = (pairs) => pairs.map(([h, l]) => k((h + l) / 2, h, l, (h + l) / 2));

test('swing points need lower highs (higher lows) on both sides', () => {
  const cs = fromHL([[1, 0], [2, 1], [3, 2], [2.5, 1.5], [2, 1], [2.2, 1.2], [2.6, 1.6]]);
  const sw = S.findSwings(cs, 2);
  assert.deepEqual(sw.map((s) => [s.index, s.kind]), [[2, 'high'], [4, 'low']]);
});

test('labels compare each swing with the previous swing of the same kind', () => {
  // low 0 -> high 4 -> low 2 (HL) -> high 6 (HH) -> low 3 (HL) -> high 5 (LH) -> low 1 (LL)
  const zig = [0, 4, 2, 6, 3, 5, 1];
  const pairs = [[1.4, 0.6]];
  zig.forEach((p, n) => {
    const up = n === 0 ? false : zig[n] > zig[n - 1];
    // two candles approaching, the pivot, then continue
    pairs.push(up ? [p - 0.6, p - 1.2] : [p + 1.2, p + 0.6]);
    pairs.push(up ? [p - 0.3, p - 0.9] : [p + 0.9, p + 0.3]);
    pairs.push(up ? [p, p - 0.5] : [p + 0.5, p]);
  });
  pairs.push([1.9, 1.3], [2.2, 1.6]); // two higher candles confirm the last low
  const { swings, trend } = S.analyse(fromHL(pairs));
  assert.deepEqual(swings.map((s) => s.label), [null, null, 'HL', 'HH', 'HL', 'LH', 'LL']);
  assert.equal(trend.dir, 'down'); // latest high LH, latest low LL
});

test('trend needs both the latest high and latest low to agree', () => {
  const sw = (labels) => labels.map((label, n) => ({ kind: label[1] === 'H' ? 'high' : 'low', label, index: n }));
  assert.equal(S.trendFrom(sw(['HH', 'HL'])).dir, 'up');
  assert.equal(S.trendFrom(sw(['LH', 'LL'])).dir, 'down');
  assert.equal(S.trendFrom(sw(['HH', 'LL'])).dir, 'range');
  assert.equal(S.trendFrom(sw(['LH', 'HL'])).dir, 'range');
  assert.equal(S.trendFrom(sw(['HH'])).dir, 'range');
});

test('generated charts have exactly the designed swings with clear comparisons', () => {
  const rng = C.mulberry32(77);
  for (const scenario of S.SCENARIOS) {
    for (let n = 0; n < 80; n++) {
      const g = S.generateStructure(rng, { scenario });
      const again = S.analyse(g.candles);
      assert.equal(again.swings.length, g.swings.length);
      assert.equal(again.trend.dir, g.trend);
      for (const s of g.swings) {
        if (s.label) assert.ok(Math.abs(s.diff) >= S.STRUCTURE.minDiff, scenario);
        assert.ok(S.LABELS[s.label] ? S.LABELS[s.label].kind === s.kind : s.label === null);
      }
      assert.equal(g.swings.filter((s) => s.label === null).length, 2, 'first high and first low are unlabelled');
      for (const c of g.candles) assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c), 'valid OHLC');
    }
  }
});

test('trend can be requested and is always backed by the detected labels', () => {
  const rng = C.mulberry32(9);
  for (const t of ['up', 'down', 'range']) {
    for (let n = 0; n < 40; n++) {
      const g = S.generateStructure(rng, { trend: t });
      assert.equal(g.trend, t);
      const { lastHigh, lastLow } = S.trendFrom(g.swings);
      if (t === 'up') assert.deepEqual([lastHigh.label, lastLow.label], ['HH', 'HL']);
      if (t === 'down') assert.deepEqual([lastHigh.label, lastLow.label], ['LH', 'LL']);
    }
  }
});
