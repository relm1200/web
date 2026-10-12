/*
 * Market structure engine: swing detection, HH/HL/LH/LL labelling, trend
 * direction, and generation of charts with a known structure.
 * Browser: window.StructureLab (needs window.CandleLab). Node: module.exports.
 *
 * Definitions (standard Dow Theory reading of price swings):
 * - Swing high: a candle whose high is above the highs of the N candles on
 *   each side. Swing low: the mirror image. Highs and lows must alternate.
 * - Each swing high is a Higher High (HH) or Lower High (LH) compared with the
 *   previous swing high; each swing low is a Higher Low (HL) or Lower Low (LL)
 *   compared with the previous swing low.
 * - Uptrend: latest high is HH and latest low is HL. Downtrend: LH and LL.
 *   Anything else is a range (no clear trend, or a trend in transition).
 */
(function (root, factory) {
  const C = typeof module === 'object' && module.exports ? require('./patterns.js') : root.CandleLab;
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StructureLab = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const R = (rng, a, b) => a + (b - a) * rng();
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  const STRUCTURE = {
    strength: 2, // candles on each side that must be lower (higher) than a swing high (low)
    minDiff: 0.3, // HH/LH and HL/LL comparisons must differ by at least this many average ranges
  };

  const LABELS = {
    HH: { name: 'Higher High', kind: 'high', bias: 'bullish', rule: 'A swing high above the previous swing high.' },
    LH: { name: 'Lower High', kind: 'high', bias: 'bearish', rule: 'A swing high below the previous swing high.' },
    HL: { name: 'Higher Low', kind: 'low', bias: 'bullish', rule: 'A swing low above the previous swing low.' },
    LL: { name: 'Lower Low', kind: 'low', bias: 'bearish', rule: 'A swing low below the previous swing low.' },
  };

  const TRENDS = {
    up: { name: 'Uptrend', rule: 'The latest swing high is a Higher High and the latest swing low is a Higher Low.' },
    down: { name: 'Downtrend', rule: 'The latest swing high is a Lower High and the latest swing low is a Lower Low.' },
    range: { name: 'Range / no clear trend', rule: 'The latest high and low disagree (HH with LL, or LH with HL), so neither side controls the structure.' },
  };

  const SOURCE_NOTE =
    'Neither attached document defines swing structure; they only refer to “uptrends” and “downtrends”. These rules follow the standard Dow Theory definition used across technical analysis.';

  // ---------- detection ----------

  function findSwings(cs, n = STRUCTURE.strength) {
    const raw = [];
    for (let i = n; i < cs.length - n; i++) {
      let hi = true, lo = true;
      for (let j = i - n; j <= i + n; j++) {
        if (j === i) continue;
        if (cs[j].h >= cs[i].h) hi = false;
        if (cs[j].l <= cs[i].l) lo = false;
      }
      if (hi) raw.push({ index: i, kind: 'high', price: cs[i].h });
      if (lo) raw.push({ index: i, kind: 'low', price: cs[i].l });
    }
    // enforce alternation: of two same-kind swings in a row keep the more extreme
    const out = [];
    for (const s of raw) {
      const prev = out[out.length - 1];
      if (prev && prev.kind === s.kind) {
        const better = s.kind === 'high' ? s.price > prev.price : s.price < prev.price;
        if (better) out[out.length - 1] = s;
      } else out.push(s);
    }
    return out;
  }

  // Adds `label` (HH/LH/HL/LL, or null for the first of each kind) and `diff`
  // (distance from the previous same-kind swing, in average ranges).
  function labelSwings(cs, swings) {
    const atr = C.avgRange(cs, cs.length, cs.length);
    let lastHigh = null, lastLow = null;
    return swings.map((s) => {
      const prev = s.kind === 'high' ? lastHigh : lastLow;
      let label = null, diff = null;
      if (prev) {
        diff = (s.price - prev.price) / atr;
        if (s.kind === 'high') label = s.price > prev.price ? 'HH' : 'LH';
        else label = s.price > prev.price ? 'HL' : 'LL';
      }
      const out = { ...s, label, diff, prevIndex: prev ? prev.index : null };
      if (s.kind === 'high') lastHigh = s; else lastLow = s;
      return out;
    });
  }

  function trendFrom(labelled) {
    const lastHigh = [...labelled].reverse().find((s) => s.kind === 'high' && s.label);
    const lastLow = [...labelled].reverse().find((s) => s.kind === 'low' && s.label);
    if (!lastHigh || !lastLow) return { dir: 'range', lastHigh, lastLow };
    let dir = 'range';
    if (lastHigh.label === 'HH' && lastLow.label === 'HL') dir = 'up';
    if (lastHigh.label === 'LH' && lastLow.label === 'LL') dir = 'down';
    return { dir, lastHigh, lastLow };
  }

  function analyse(cs) {
    const swings = labelSwings(cs, findSwings(cs));
    return { swings, trend: trendFrom(swings) };
  }

  // ---------- generation ----------

  // Label sequences per scenario, applied to swings after the first high and low.
  function scenarioLabels(rng, scenario, count) {
    const seq = [];
    const flip = Math.floor(count / 2) + Math.floor(rng() * 2);
    for (let k = 0; k < count; k++) {
      let dir;
      if (scenario === 'up') dir = 'up';
      else if (scenario === 'down') dir = 'down';
      else if (scenario === 'reversal-up') dir = k < flip ? 'down' : 'up';
      else if (scenario === 'reversal-down') dir = k < flip ? 'up' : 'down';
      else dir = rng() < 0.5 ? 'up' : 'down';
      seq.push({ dir });
    }
    return seq;
  }

  // Pivot prices (in u) that follow the requested directions, with clear margins.
  function buildPivots(rng, scenario, nPivots) {
    const startHigh = rng() < 0.5;
    const pivots = [];
    let p = 0;
    pivots.push({ kind: startHigh ? 'high' : 'low', price: p });
    p += startHigh ? -R(rng, 2, 3.5) : R(rng, 2, 3.5);
    pivots.push({ kind: startHigh ? 'low' : 'high', price: p });
    const dirs = scenarioLabels(rng, scenario, nPivots - 2);
    for (const d of dirs) {
      const prev = pivots[pivots.length - 1];
      const kind = prev.kind === 'high' ? 'low' : 'high';
      const sameKindPrev = pivots[pivots.length - 2];
      const margin = R(rng, 0.6, 1.8);
      const target = d.dir === 'up' ? sameKindPrev.price + margin : sameKindPrev.price - margin;
      // keep each leg at least 1.5u long
      const minLeg = 1.5;
      if (kind === 'high' && target < prev.price + minLeg) return null;
      if (kind === 'low' && target > prev.price - minLeg) return null;
      pivots.push({ kind, price: target });
    }
    return pivots;
  }

  // Candles that travel from pivot to pivot, with the pivot candle holding the extreme.
  function candlesFromPivots(rng, pivots) {
    const cs = [];
    const lead = 3;
    // lead-in candles drifting toward the first pivot
    const first = pivots[0];
    const towards = first.kind === 'high' ? -1 : 1;
    let price = first.price + towards * R(rng, 1.4, 2.0);
    for (let k = 0; k < lead; k++) {
      const next = price + (first.price - price) * ((k + 1) / (lead + 1));
      cs.push(legCandle(rng, price, next));
      price = next;
    }
    const pivotIdx = [];
    for (let p = 0; p < pivots.length; p++) {
      const pv = pivots[p];
      // pivot candle
      const up = pv.kind === 'high';
      const o = price;
      const c = pv.price + (up ? -1 : 1) * R(rng, 0.15, 0.4);
      const k = up
        ? { o, c, h: pv.price, l: Math.min(o, c) - R(rng, 0.05, 0.2) }
        : { o, c, l: pv.price, h: Math.max(o, c) + R(rng, 0.05, 0.2) };
      pivotIdx.push(cs.length);
      cs.push(k);
      price = c;
      // leg to the next pivot (or a short tail after the last one)
      const nxt = pivots[p + 1];
      const end = nxt ? nxt.price : pv.price + (up ? -1 : 1) * R(rng, 1.2, 1.8);
      const steps = nxt ? 3 + Math.floor(rng() * 3) : 3;
      const bound = { hi: up ? pv.price : end, lo: up ? end : pv.price };
      for (let s = 1; s <= steps; s++) {
        const tgt = pv.price + (end - pv.price) * (s / (steps + 1)) + R(rng, -0.12, 0.12);
        const kc = legCandle(rng, price, tgt);
        // keep the leg strictly inside its two pivots
        kc.h = Math.min(kc.h, Math.max(bound.hi, bound.lo) - 0.08);
        kc.l = Math.max(kc.l, Math.min(bound.hi, bound.lo) + 0.08);
        kc.h = Math.max(kc.h, Math.max(kc.o, kc.c));
        kc.l = Math.min(kc.l, Math.min(kc.o, kc.c));
        cs.push(kc);
        price = kc.c;
      }
    }
    return { candles: cs, pivotIdx };
  }

  function legCandle(rng, o, c) {
    return { o, c, h: Math.max(o, c) + R(rng, 0.04, 0.22), l: Math.min(o, c) - R(rng, 0.04, 0.22) };
  }

  const SCENARIOS = ['up', 'down', 'range', 'reversal-up', 'reversal-down'];

  // Returns a chart whose detected swings are exactly the designed pivots, with
  // every comparison clear by at least STRUCTURE.minDiff average ranges.
  function generateStructure(rng, opts = {}) {
    const want = opts.trend; // 'up' | 'down' | 'range' | undefined
    for (let attempt = 0; attempt < 500; attempt++) {
      const scenario = opts.scenario || pick(rng, SCENARIOS);
      const nPivots = opts.pivots || 6 + Math.floor(rng() * 3);
      const pivots = buildPivots(rng, scenario, nPivots);
      if (!pivots) continue;
      const { candles, pivotIdx } = candlesFromPivots(rng, pivots);
      const m = C._internal.toMarket ? C._internal.toMarket(rng, candles) : null;
      if (!m) throw new Error('CandleLab._internal.toMarket is required');
      const { swings, trend } = analyse(m.candles);
      if (swings.length !== pivots.length) continue;
      if (swings.some((s, k) => s.index !== pivotIdx[k] || s.kind !== pivots[k].kind)) continue;
      if (swings.some((s) => s.label && Math.abs(s.diff) < STRUCTURE.minDiff)) continue;
      if (want && trend.dir !== want) continue;
      return { pair: m.pair, tf: m.tf, candles: m.candles, swings, trend: trend.dir, scenario, attempts: attempt + 1 };
    }
    throw new Error('Could not generate structure chart');
  }

  return { STRUCTURE, LABELS, TRENDS, SOURCE_NOTE, SCENARIOS, findSwings, labelSwings, trendFrom, analyse, generateStructure };
});
