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

// ---------- source-derived rules (Monster Guide / 58-pattern manual) ----------

test('every pattern cites a source document or explains why it has none', () => {
  for (const p of L.PATTERNS) {
    assert.ok(['reversal', 'continuation', 'indecision'].includes(p.role), p.id);
    assert.ok(p.refs.length > 0 || p.notes.length > 0, `${p.id} has no source`);
    for (const r of p.refs) assert.ok(L.SOURCES[r.src] && Number.isInteger(r.n), p.id);
  }
});

test('hammer must close in the top quarter of its range (Monster Guide p. 9)', () => {
  const ok = trend('down');
  const p = lastClose(ok);
  // body 0.25, lower wick 0.9, close at the top
  ok.push(k(p, p + 0.27, p - 0.9, p + 0.25));
  assert.ok(L.detectAt(ok, ok.length - 1).includes('hammer'));
  // same proportions but bearish and with more upper wick: close at ~0.62 of the range
  const bad = trend('down');
  const q = lastClose(bad);
  bad.push(k(q, q + 0.14, q - 1.0, q - 0.25));
  assert.ok(!L.detectAt(bad, bad.length - 1).includes('hammer'));
});

test('tweezer bottom accepts a bullish first candle that shows rejection (Monster Guide p. 12)', () => {
  const cs = trend('down');
  const p = lastClose(cs);
  cs.push(k(p, p + 0.3, p - 0.8, p + 0.1)); // bullish, long lower wick
  cs.push(k(p + 0.1, p + 0.6, p - 0.8, p + 0.5)); // re-tests the low, closes bullish
  assert.ok(L.detectAt(cs, cs.length - 1).includes('tweezer-bottom'));
  cs[cs.length - 1] = k(p + 0.1, p + 0.6, p - 0.6, p + 0.5); // misses the low
  assert.ok(!L.detectAt(cs, cs.length - 1).includes('tweezer-bottom'));
});

test('rising three methods fails if a middle candle breaks candle 1’s range', () => {
  const q = L.generateDrill('rising-three-methods', L.mulberry32(8));
  const cs = q.candles.map((c) => ({ ...c }));
  const first = cs[q.index - 4];
  cs[q.index - 2].l = first.l - (first.h - first.l) * 0.05;
  assert.ok(!L.matches(cs, q.index, 'rising-three-methods'));
});

test('reading a candle: wick rejection outweighs a small body’s colour (Monster Guide p. 34)', () => {
  assert.deepEqual(L.classifyCandle(k(1, 2.2, 0.95, 1.2)), ['reject-high']); // bullish close, long upper wick
  assert.deepEqual(L.classifyCandle(k(1, 1.05, -0.2, 0.8)), ['reject-low']); // bearish close, long lower wick
  assert.deepEqual(L.classifyCandle(k(1, 2.1, 0.95, 2.0)), ['buyers']);
  assert.deepEqual(L.classifyCandle(k(1, 1.5, 0.5, 1.02)), ['indecision']);
});

test('candle-reading charts always have exactly one correct reading', () => {
  const rng = L.mulberry32(31);
  for (const kind of L.READ_KINDS) {
    for (let n = 0; n < 100; n++) {
      const q = L.generateRead(rng, kind.id);
      assert.deepEqual(L.classifyCandle(q.candles[q.index]), [kind.id]);
    }
  }
});

test('setup charts match every requested combination of the three checks', () => {
  const rng = L.mulberry32(4242);
  for (const id of L.SETUP_PATTERNS) {
    for (const trendOk of [true, false]) for (const level of [true, false]) for (const size of [true, false]) {
      const q = L.generateSetup(id, rng, { trend: trendOk, level, size });
      assert.ok(L.matches(q.candles, q.index, id), id);
      const ev = L.evaluateSetup(q.candles, q.index, id, q.level);
      assert.equal(ev.trend.ok, trendOk, `${id} trend`);
      assert.equal(ev.level.ok, level, `${id} level`);
      assert.equal(ev.size.ok, size, `${id} size`);
      assert.equal(ev.pass, trendOk && level && size);
    }
  }
});

test('moving average and big-trend direction', () => {
  const cs = [];
  for (let n = 0; n < 40; n++) cs.push(k(n, n + 0.6, n - 0.6, n + 0.5));
  assert.equal(L.sma(cs, 19, 20), cs.slice(0, 20).reduce((t, c) => t + c.c, 0) / 20);
  assert.equal(L.bigTrend(cs, 39).dir, 'up');
  assert.equal(L.bigTrend(cs.map((c) => ({ o: -c.o, h: -c.l, l: -c.h, c: -c.c })).map((c) => ({ o: c.o + 100, h: c.h + 100, l: c.l + 100, c: c.c + 100 })), 39).dir, 'down');
});
