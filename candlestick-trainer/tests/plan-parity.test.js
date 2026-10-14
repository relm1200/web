// Checks that the Trend Pullback Plan indicator (tradingview/trend-pullback-plan.pine) makes the
// same decisions as its JavaScript reference (js/plan.js) on every bar. The Pine helpers,
// triggers and decision functions are translated to JavaScript and fed the same series
// (averages, momentum, Vortex, structure, levels) that js/plan.js computes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../js/patterns.js');
const P = require('../js/plan.js');
const { translate } = require('./lib/pine-translate.js');

const PINE = fs.readFileSync(path.join(__dirname, '..', 'tradingview', 'trend-pullback-plan.pine'), 'utf8');
const JS = translate(PINE, '// ───────────── candle helpers', '// ───────────── series');
const factory = new Function('bar', 'avgRange', 'i_requireCtx',
  `${JS}\nreturn { filterDir, inZone, planTrade, patHigh, patLow, bearName, bearLen, bullName, bullLen };`);

function pineDecisions(cs, i, ctx, opts) {
  const { sr, st } = ctx;
  const bar = { high: (k) => cs[i - k].h, low: (k) => cs[i - k].l, open: (k) => cs[i - k].o, close: (k) => cs[i - k].c };
  const avgRange = (k) => sr.avgRange[i - k];
  const f = factory(bar, avgRange, opts.requireCtx);
  const s = st[i];
  const dir = f.filterDir(sr.maF[i], sr.maM[i], sr.maS[i], cs[i].c, sr.macd[i], sr.sig[i], sr.viP[i], sr.viM[i], s.sTrend, opts.momSig);
  const levels = ctx.stT[i].levels.filter((l) => l.conf >= i - opts.lvlLook).map((l) => l.price).concat(opts.levels);
  const buf = opts.bufPips * opts.pipSize;
  const side = (d) => {
    const name = d < 0 ? f.bearName : f.bullName;
    const len = d < 0 ? f.bearLen : f.bullLen;
    const ext = d < 0 ? f.patHigh(len) : f.patLow(len);
    const a = avgRange(len);
    const zone = f.inZone(d, ext, cs[i].c, sr.maM[i], a, opts.zoneTol, opts.levels);
    const swingExt = opts.stopMode === 'Pattern' ? NaN : d < 0 ? s.hiCur : s.loCur;
    const [ok, stop, t1, t2, rr1] = f.planTrade(d, cs[i].c, ext, swingExt, sr.maS[i], a, buf, opts.minRR, levels);
    const signal = !sr.chop[i] && dir === d && name !== '' && zone && ok;
    return { name, len, ext, zone, ok, stop, t1, t2, rr1, signal };
  };
  return { dir, sell: side(-1), buy: side(1) };
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;

function compare(cs, opts) {
  const o = Object.assign({}, P.DEFAULTS, opts);
  const ref = P.run(cs, o);
  const ctx = { sr: ref.series, st: ref.structure, stT: ref.targets };
  let signals = 0, trades = 0;
  for (let i = 16; i < cs.length; i++) {
    const want = ref.rows[i];
    const got = pineDecisions(cs, i, ctx, o);
    const at = `bar ${i}`;
    assert.equal(got.dir, want.dir, at + ' dir');
    for (const k of ['sell', 'buy']) {
      const g = got[k], w = want[k];
      assert.equal(g.name, w.name, `${at} ${k} name`);
      assert.equal(g.len, w.len, `${at} ${k} len`);
      assert.ok(same(g.ext, w.ext), `${at} ${k} ext`);
      assert.equal(g.zone, w.zone, `${at} ${k} zone`);
      assert.equal(g.ok, w.plan.ok, `${at} ${k} plan ok`);
      for (const f of ['stop', 't1', 't2', 'rr1']) assert.ok(same(g[f], w.plan[f]), `${at} ${k} ${f}: ${g[f]} vs ${w.plan[f]}`);
      assert.equal(g.signal, w.signal, `${at} ${k} signal`);
      if (w.signal) signals++;
      if (w.name) trades++;
    }
  }
  return { signals, triggers: trades };
}

const toPrice = (raw, base) => raw.map((k) => ({ o: base + k.o * 0.1, h: base + k.h * 0.1, l: base + k.l * 0.1, c: base + k.c * 0.1 }));

test('Pine plan decisions match the reference on generated charts', () => {
  const rng = L.mulberry32(515);
  let signals = 0, triggers = 0;
  for (let n = 0; n < 60; n++) {
    // trending stretches with pullbacks: alternating drifts
    const raw = [];
    let last = 0;
    for (let leg = 0; leg < 8; leg++) {
      const drift = (leg % 2 ? -1 : 1) * (n % 3 === 0 ? 0.45 : 0.3) * (leg % 4 < 2 ? 1 : -1);
      const part = L._internal.series(rng, last, 12 + Math.floor(rng() * 10), drift);
      raw.push(...part);
      last = part[part.length - 1].c;
    }
    const cs = toPrice(raw, 150);
    const r = compare(cs, { pipSize: 0.01, levels: n % 2 ? [cs[cs.length - 30].c, cs[cs.length - 50].h] : [] });
    signals += r.signals;
    triggers += r.triggers;
  }
  // charts built around the plan's own trigger patterns, with pullbacks to levels
  for (const id of L.SETUP_PATTERNS) {
    for (let n = 0; n < 30; n++) {
      const want = { trend: rng() < 0.6, level: rng() < 0.6, size: rng() < 0.6 };
      const g = L.generateSetup(id, rng, want);
      // 60 warm-up candles in front, so the averages, Vortex and structure exist at the pattern
      const scale = g.candles.slice(0, 10).reduce((t, k) => t + k.h - k.l, 0) / 10;
      const warm = L._internal.series(rng, 0, 60, (L.BY_ID[id].signal === 'bullish') === (n % 2 === 0) ? 0.35 : -0.35);
      const end = warm[warm.length - 1].c;
      const cs = warm.map((k) => ({ o: g.candles[0].o + (k.o - end) * scale, h: g.candles[0].o + (k.h - end) * scale, l: g.candles[0].o + (k.l - end) * scale, c: g.candles[0].o + (k.c - end) * scale })).concat(g.candles);
      const r = compare(cs, { pipSize: g.pair.pip, levels: n % 3 ? [g.level] : [] });
      signals += r.signals;
      triggers += r.triggers;
    }
  }
  // looser settings so the full signal path (all conditions true) is exercised often
  for (let n = 0; n < 40; n++) {
    const raw = [];
    let last = 0;
    for (let leg = 0; leg < 10; leg++) {
      const part = L._internal.series(rng, last, 10 + Math.floor(rng() * 10), (leg % 2 ? -0.25 : 0.55) * (n % 2 ? 1 : -1));
      raw.push(...part);
      last = part[part.length - 1].c;
    }
    const r = compare(toPrice(raw, 150), { pipSize: 0.01, minRR: 0.5, zoneTol: 1.0, tgtN: 3 });
    signals += r.signals;
    triggers += r.triggers;
  }
  assert.ok(triggers > 300, `only ${triggers} trigger bars compared`);
  assert.ok(signals > 10, `only ${signals} full signals compared`);
  console.log(`  compared ${triggers} trigger bars, ${signals} full signals`);
});

test('Pine plan decisions match the reference with pattern context required', () => {
  const rng = L.mulberry32(99);
  for (let n = 0; n < 20; n++) {
    const cs = toPrice(L._internal.series(rng, 0, 160, n % 2 ? 0.3 : -0.3), 150);
    compare(cs, { pipSize: 0.01, requireCtx: true, stopMode: 'Pattern or latest swing (further)', momSig: true, tgtN: 2 });
  }
});

test('Pine plan decisions match the reference on real USD/JPY 5-minute data', () => {
  const file = path.join(__dirname, '..', 'tradingview', 'reference', 'FX_USDJPY_5m.json');
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cs = d.c.map((c, i) => ({ o: d.o[i], h: d.h[i], l: d.l[i], c }));
  const r = compare(cs, { pipSize: 0.01 });
  assert.ok(r.triggers > 10, `only ${r.triggers} trigger bars on real data`);
});
