/*
 * Reference implementation of the "Trend Pullback Plan" (tradingview/trend-pullback-plan.pine).
 * Written independently of the Pine code so the parity test can compare the two, and used to
 * list the signals the indicator should show on real data. Node only.
 */
'use strict';
const C = require('./patterns.js');

const DEFAULTS = {
  maType: 'EMA', fast: 8, mid: 20, slow: 50, mFast: 12, mSlow: 26, mSig: 9, viLen: 50, swingN: 2,
  zoneTol: 0.3, requireCtx: false, chopBars: 20, chopMax: 3, levels: [], lvlLook: 100,
  bufPips: 2, minRR: 1.5, pipSize: 0.01, stopMode: 'Pattern', momSig: false, tgtN: 5,
};

// ---------- series (Pine semantics; NaN where Pine has na) ----------

function sma(xs, len) {
  return xs.map((_, i) => {
    if (i < len - 1) return NaN;
    let t = 0;
    for (let j = i - len + 1; j <= i; j++) t += xs[j];
    return t / len;
  });
}

// Pine's ta.ema: NaN until `len` values exist, seeded with their simple average.
function ema(xs, len) {
  const a = 2 / (len + 1);
  const out = new Array(xs.length).fill(NaN);
  let prev = NaN, count = 0, sum = 0;
  for (let i = 0; i < xs.length; i++) {
    if (Number.isNaN(xs[i])) continue;
    if (Number.isNaN(prev)) {
      sum += xs[i];
      count++;
      if (count === len) { prev = sum / len; out[i] = prev; }
      continue;
    }
    prev = a * xs[i] + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

function sumLast(xs, i, len) {
  if (i < len - 1) return NaN;
  let t = 0;
  for (let j = i - len + 1; j <= i; j++) t += xs[j];
  return t;
}

function series(cs, o) {
  const close = cs.map((k) => k.c);
  const pick = (len) => (o.maType === 'EMA' ? ema(close, len) : sma(close, len));
  const maF = pick(o.fast), maM = pick(o.mid), maS = pick(o.slow);
  const e1 = ema(close, o.mFast), e2 = ema(close, o.mSlow);
  const macd = close.map((_, i) => e1[i] - e2[i]);
  const sig = ema(macd, o.mSig);
  const vmP = cs.map((k, i) => (i ? Math.abs(k.h - cs[i - 1].l) : NaN));
  const vmM = cs.map((k, i) => (i ? Math.abs(k.l - cs[i - 1].h) : NaN));
  const tr = cs.map((k, i) => (i ? Math.max(k.h - k.l, Math.abs(k.h - cs[i - 1].c), Math.abs(k.l - cs[i - 1].c)) : k.h - k.l));
  const viP = cs.map((_, i) => sumLast(vmP, i, o.viLen) / sumLast(tr, i, o.viLen));
  const viM = cs.map((_, i) => sumLast(vmM, i, o.viLen) / sumLast(tr, i, o.viLen));
  // ta.cross(macd, 0): the sign of macd changes between bars (crossover or crossunder)
  const cross = macd.map((m, i) => i > 0 && ((m > 0 && macd[i - 1] <= 0) || (m < 0 && macd[i - 1] >= 0)));
  const chop = cs.map((_, i) => {
    if (i < o.chopBars - 1) return false;
    let n = 0;
    for (let j = i - o.chopBars + 1; j <= i; j++) if (cross[j]) n++;
    return n >= o.chopMax;
  });
  const avgRange = sma(cs.map((k) => k.h - k.l), 10);
  return { maF, maM, maS, macd, sig, viP, viM, chop, avgRange };
}

// Streaming market structure exactly as the Pine script keeps it, bar by bar.
function structureStream(cs, n) {
  const out = [];
  let lastKind = 0, hiCur = NaN, hiRef = NaN, loCur = NaN, loRef = NaN, hiTag = '', loTag = '';
  const lv = []; // {price, conf}
  for (let i = 0; i < cs.length; i++) {
    let swH = false, swL = false;
    if (i >= 2 * n) {
      swH = true; swL = true;
      const c = i - n;
      for (let j = i - 2 * n; j <= i; j++) {
        if (j === c) continue;
        if (cs[j].h >= cs[c].h) swH = false;
        if (cs[j].l <= cs[c].l) swL = false;
      }
    }
    if (swH) {
      const p = cs[i - n].h;
      if (lastKind !== 1 || p > hiCur) {
        if (lastKind !== 1) hiRef = hiCur;
        hiCur = p; lastKind = 1;
        hiTag = Number.isNaN(hiRef) ? '' : p > hiRef ? 'HH' : 'LH';
      }
      lv.push({ price: p, conf: i });
    }
    if (swL) {
      const p = cs[i - n].l;
      if (lastKind !== -1 || p < loCur) {
        if (lastKind !== -1) loRef = loCur;
        loCur = p; lastKind = -1;
        loTag = Number.isNaN(loRef) ? '' : p > loRef ? 'HL' : 'LL';
      }
      lv.push({ price: p, conf: i });
    }
    const sTrend = hiTag === 'HH' && loTag === 'HL' ? 1 : hiTag === 'LH' && loTag === 'LL' ? -1 : 0;
    out.push({ hiCur, loCur, hiTag, loTag, sTrend, levels: lv.slice() });
  }
  return out;
}

// ---------- decisions ----------

function filterDir(f, m, s, c, mac, sig, vp, vm, st, reqSig = false) {
  const bull = f > m && m > s && c > m && mac > 0 && (!reqSig || mac > sig) && vp > vm && st === 1;
  const bear = f < m && m < s && c < m && mac < 0 && (!reqSig || mac < sig) && vm > vp && st === -1;
  return bull ? 1 : bear ? -1 : 0;
}

function inZone(dir, ext, c, midMA, a, tol, manual) {
  if (dir < 0 ? ext >= midMA - tol * a : ext <= midMA + tol * a) return true;
  return manual.some((lv) => (dir < 0 ? ext >= lv - tol * a && c <= lv : ext <= lv + tol * a && c >= lv));
}

function planTrade(dir, entry, ext, swingExt, slowMA, a, buf, minRR, levels) {
  const base = Number.isNaN(swingExt) ? ext : dir < 0 ? Math.max(ext, swingExt) : Math.min(ext, swingExt);
  const stop = dir < 0 ? base + buf : base - buf;
  const risk = Math.abs(entry - stop);
  const stopOk = dir < 0 ? stop <= slowMA : stop >= slowMA;
  const beyond = (lv, ref) => (dir < 0 ? lv < ref : lv > ref);
  const nearest = (cands) => cands.reduce((best, lv) => (Number.isNaN(best) || (dir < 0 ? lv > best : lv < best) ? lv : best), NaN);
  const t1 = nearest(levels.filter((lv) => beyond(lv, entry)));
  const t2 = Number.isNaN(t1) ? NaN : nearest(levels.filter((lv) => beyond(lv, dir < 0 ? t1 - 0.25 * a : t1 + 0.25 * a)));
  const rr1 = risk > 0 && !Number.isNaN(t1) ? Math.abs(t1 - entry) / risk : NaN;
  const rrOk = !Number.isNaN(rr1) && rr1 >= minRR;
  return { ok: stopOk && rrOk, stop, t1, t2, rr1, stopOk, rrOk };
}

// Shape-only triggers (Wick Reader rules without the pattern's own trend context).
function triggers(cs, i, o) {
  const sh = (k) => C.shape(cs[i - k]);
  const a = (L) => C.avgRange(cs, i - L + 1);
  const ctx = (L) => C.trendInto(cs, i - L + 1).dir;
  const closePos = (k) => { const s = sh(k); return s.range > 0 ? (cs[i - k].c - cs[i - k].l) / s.range : 0.5; };
  const small = (s) => s.body > 0.1 * s.range && s.body <= 0.35 * s.range;
  const long = (s, av) => s.body >= 0.6 * s.range && s.body >= 0.8 * av;
  const c0 = cs[i], c1 = cs[i - 1], c2 = cs[i - 2];
  const s0 = sh(0), s1 = sh(1), s2 = sh(2);
  const a1 = a(1), a2 = a(2), a3 = a(3);
  const bearEngS = s1.bull && s1.body >= 0.3 * a2 && s0.bear && c0.o >= c1.c && c0.c <= c1.o && s0.body > 1.1 * s1.body;
  const sstarS = small(s0) && s0.upper >= 2 * s0.body && s0.upper >= 0.55 * s0.range && s0.lower <= 0.12 * s0.range && s0.range >= 0.7 * a1 && closePos(0) <= 0.25;
  const estarS = s2.bull && long(s2, a3) && s1.body <= 0.3 * s2.body && s1.range <= 0.6 * s2.range && s1.bodyBot >= c2.c - 0.1 * s2.body && s0.bear && c0.c <= c2.c - 0.5 * s2.body;
  const dccS = s1.bull && long(s1, a2) && s0.bear && c0.o >= c1.c && c0.c < c1.c - 0.5 * s1.body && c0.c > c1.o;
  const bullEngS = s1.bear && s1.body >= 0.3 * a2 && s0.bull && c0.o <= c1.c && c0.c >= c1.o && s0.body > 1.1 * s1.body;
  const hamS = small(s0) && s0.lower >= 2 * s0.body && s0.lower >= 0.55 * s0.range && s0.upper <= 0.12 * s0.range && s0.range >= 0.7 * a1 && closePos(0) >= 0.75;
  const mstarS = s2.bear && long(s2, a3) && s1.body <= 0.3 * s2.body && s1.range <= 0.6 * s2.range && s1.bodyTop <= c2.c + 0.1 * s2.body && s0.bull && c0.c >= c2.c + 0.5 * s2.body;
  const pierceS = s1.bear && long(s1, a2) && s0.bull && c0.o <= c1.c && c0.c > c1.c + 0.5 * s1.body && c0.c < c1.o;
  const req = (ok, L, want) => ok && (!o.requireCtx || ctx(L) === want);
  const estar = req(estarS, 3, 'up'), bearEng = req(bearEngS, 2, 'up'), dcc = req(dccS, 2, 'up'), sstar = req(sstarS, 1, 'up');
  const mstar = req(mstarS, 3, 'down'), bullEng = req(bullEngS, 2, 'down'), pierce = req(pierceS, 2, 'down'), ham = req(hamS, 1, 'down');
  const bearName = estar ? 'Evening Star' : bearEng ? 'Bearish Engulfing' : dcc ? 'Dark Cloud Cover' : sstar ? 'Shooting Star' : '';
  const bullName = mstar ? 'Morning Star' : bullEng ? 'Bullish Engulfing' : pierce ? 'Piercing Line' : ham ? 'Hammer' : '';
  return { bearName, bearLen: estar ? 3 : bearEng || dcc ? 2 : 1, bullName, bullLen: mstar ? 3 : bullEng || pierce ? 2 : 1 };
}

// Every bar's decision. Bars with too little history are skipped (Pine has na there).
function run(cs, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const sr = series(cs, o);
  const st = structureStream(cs, o.swingN);
  const stT = structureStream(cs, o.tgtN); // levels for targets come from clearer swings
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    const s = st[i];
    const dir = filterDir(sr.maF[i], sr.maM[i], sr.maS[i], cs[i].c, sr.macd[i], sr.sig[i], sr.viP[i], sr.viM[i], s.sTrend, o.momSig);
    const row = { i, dir, chop: sr.chop[i], sell: null, buy: null };
    if (i >= 15) {
      const tg = triggers(cs, i, o);
      const levels = stT[i].levels.filter((l) => l.conf >= i - o.lvlLook).map((l) => l.price).concat(o.levels);
      const buf = o.bufPips * o.pipSize;
      for (const side of [-1, 1]) {
        const name = side < 0 ? tg.bearName : tg.bullName;
        const L = side < 0 ? tg.bearLen : tg.bullLen;
        let ext = side < 0 ? -Infinity : Infinity;
        for (let j = i - L + 1; j <= i; j++) ext = side < 0 ? Math.max(ext, cs[j].h) : Math.min(ext, cs[j].l);
        const a = sr.avgRange[i - L];
        const zone = inZone(side, ext, cs[i].c, sr.maM[i], a, o.zoneTol, o.levels);
        const swingExt = o.stopMode === 'Pattern' ? NaN : side < 0 ? s.hiCur : s.loCur;
        const plan = planTrade(side, cs[i].c, ext, swingExt, sr.maS[i], a, buf, o.minRR, levels);
        const signal = !sr.chop[i] && dir === side && name !== '' && zone && plan.ok;
        const rec = { name, len: L, ext, zone, plan, signal };
        if (side < 0) row.sell = rec; else row.buy = rec;
      }
    }
    out.push(row);
  }
  return { rows: out, series: sr, structure: st, targets: stT, options: o };
}

module.exports = { DEFAULTS, sma, ema, series, structureStream, filterDir, inZone, planTrade, triggers, run };
