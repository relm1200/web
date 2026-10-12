// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/patterns.js');

const k = (o, h, l, c) => ({ o, h, l, c });

// Six falling (or rising) candles, each with range 1, to give a clear trend.
function trend(dir, start = 100) {
  const out = [];
  let p = start;
  for (let i = 0; i < 8; i++) {
    const c = p + (dir === 'down' ? -0.5 : 0.5);
    out.push(k(p, Math.max(p, c) + 0.25, Math.min(p, c) - 0.25, c));
    p = c;
  }
  return out;
}
const lastClose = (cs) => cs[cs.length - 1].c;

test('every pattern has complete teaching content', () => {
  for (const p of L.PATTERNS) {
    assert.ok(p.name && p.rules.length >= 2 && p.meaning && p.confirm, p.id);
    assert.ok(['bullish', 'bearish', 'neutral'].includes(p.signal), p.id);
    for (const c of p.confuse) assert.ok(L.BY_ID[c], `${p.id} confuses unknown ${c}`);
  }
});

test('hammer and hanging man share a shape but depend on trend', () => {
  const shapeAt = (p) => k(p, p + 0.02, p - 0.9, p + 0.25); // small body, long lower wick
  const down = trend('down');
  down.push(shapeAt(lastClose(down)));
  assert.deepEqual(L.detectAt(down, down.length - 1), ['hammer']);

  const up = trend('up');
  up.push(shapeAt(lastClose(up)));
  assert.deepEqual(L.detectAt(up, up.length - 1), ['hanging-man']);
});

test('shooting star needs a prior rally', () => {
  const up = trend('up');
  const p = lastClose(up);
  up.push(k(p, p + 0.95, p - 0.25, p - 0.22));
  assert.ok(L.detectAt(up, up.length - 1).includes('shooting-star'));
  const down = trend('down');
  const q = lastClose(down);
  down.push(k(q, q + 0.95, q - 0.25, q - 0.22));
  assert.ok(!L.detectAt(down, down.length - 1).includes('shooting-star'));
  assert.ok(L.detectAt(down, down.length - 1).includes('inverted-hammer'));
});

test('bullish engulfing vs piercing line is decided by the close', () => {
  const base = trend('down');
  const p = lastClose(base);
  const bear = k(p, p + 0.05, p - 0.75, p - 0.7);
  const engulf = base.concat([bear, k(bear.c, p + 0.3, bear.c - 0.3, p + 0.2)]);
  const pierce = base.concat([k(p, p + 0.1, p - 1.6, p - 1.5), k(p - 1.52, p - 0.5, p - 1.8, p - 0.6)]);
  assert.ok(L.detectAt(engulf, engulf.length - 1).includes('bullish-engulfing'));
  assert.ok(!L.detectAt(engulf, engulf.length - 1).includes('piercing-line'));
  assert.ok(L.detectAt(pierce, pierce.length - 1).includes('piercing-line'));
  assert.ok(!L.detectAt(pierce, pierce.length - 1).includes('bullish-engulfing'));
});

test('doji is rejected when the body is too large', () => {
  const cs = trend('up');
  const p = lastClose(cs);
  cs.push(k(p, p + 0.5, p - 0.5, p + 0.02));
  assert.ok(L.detectAt(cs, cs.length - 1).includes('doji'));
  cs[cs.length - 1] = k(p, p + 0.5, p - 0.5, p + 0.3);
  assert.ok(!L.detectAt(cs, cs.length - 1).includes('doji'));
});

test('patterns are not detected without enough history for a trend', () => {
  const cs = [k(1, 1.02, 0.1, 1.01)];
  assert.deepEqual(L.detectAt(cs, 0), []);
});

test('drill generator always ends on a valid instance of the target', () => {
  const rng = L.mulberry32(12345);
  for (const p of L.PATTERNS) {
    for (let n = 0; n < 150; n++) {
      const q = L.generateDrill(p.id, rng);
      assert.equal(q.index, q.candles.length - 1);
      assert.ok(L.matches(q.candles, q.index, p.id), p.id);
      assert.ok(q.matches.includes(p.id));
      for (const c of q.candles) assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.l > 0, 'valid OHLC');
    }
  }
});

test('short drill charts still have filler and a trend', () => {
  const rng = L.mulberry32(77);
  for (const p of L.PATTERNS) {
    const q = L.generateDrill(p.id, rng, { length: 6 });
    assert.ok(q.candles.length >= 12 + p.candles, p.id);
    assert.ok(L.matches(q.candles, q.index, p.id), p.id);
  }
});

test('spot generator places exactly one instance of the target', () => {
  const rng = L.mulberry32(999);
  for (const p of L.PATTERNS.filter((x) => x.spot !== false)) {
    for (let n = 0; n < 60; n++) {
      const q = L.generateSpot(p.id, rng);
      const hits = q.candles.map((_, i) => i).filter((i) => L.matches(q.candles, i, p.id));
      assert.deepEqual(hits, [q.index], p.id);
      assert.ok(q.index < q.candles.length - 1, 'aftermath candles follow the pattern');
    }
  }
});

test('drill charts rarely qualify as a second pattern', () => {
  const rng = L.mulberry32(2024);
  let multi = 0, n = 0;
  for (const p of L.PATTERNS) {
    for (let i = 0; i < 100; i++, n++) if (L.generateDrill(p.id, rng).matches.length > 1) multi++;
  }
  assert.ok(multi / n < 0.06, `overlap rate ${(multi / n).toFixed(3)}`);
});

test('explain reports trend and per-candle proportions', () => {
  const q = L.generateDrill('morning-star', L.mulberry32(5));
  const ex = L.explain(q.candles, q.index, 'morning-star');
  assert.equal(ex.trend, 'down');
  assert.equal(ex.candles.length, 3);
  for (const c of ex.candles) assert.ok(c.bodyPct + c.upperPct + c.lowerPct >= 98 && c.bodyPct + c.upperPct + c.lowerPct <= 102);
});
