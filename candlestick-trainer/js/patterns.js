/*
 * Candlestick pattern engine: definitions, rule-based detection and
 * synthetic chart generation. Works in the browser (window.CandleLab)
 * and in Node (module.exports) so the rules can be unit tested.
 *
 * Units: generation happens in "u", roughly one average candle range.
 * Detection only uses ratios, so it is unaffected by price scaling.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CandleLab = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- utilities ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const R = (rng, a, b) => a + (b - a) * rng();
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  function mk(o, c, upper, lower) {
    return { o, h: Math.max(o, c) + upper, l: Math.min(o, c) - lower, c };
  }

  function shape(k) {
    const range = Math.max(k.h - k.l, 1e-12);
    const body = Math.abs(k.c - k.o);
    const bodyTop = Math.max(k.o, k.c);
    const bodyBot = Math.min(k.o, k.c);
    return {
      range,
      body,
      bodyTop,
      bodyBot,
      upper: k.h - bodyTop,
      lower: bodyBot - k.l,
      bull: k.c > k.o,
      bear: k.c < k.o,
    };
  }

  // ---------- context: volatility and trend ----------

  const ATR_LOOKBACK = 10;
  const TREND_LOOKBACK = 6;
  const TREND_THRESHOLD = 1.5; // net move, in average ranges

  function avgRange(cs, end, n = ATR_LOOKBACK) {
    const s = Math.max(0, end - n);
    if (end <= s) return cs[end] ? cs[end].h - cs[end].l : 1;
    let t = 0;
    for (let j = s; j < end; j++) t += cs[j].h - cs[j].l;
    return t / (end - s);
  }

  // Trend leading into the candle at `start` (the first candle of a pattern).
  function trendInto(cs, start) {
    const atr = avgRange(cs, start);
    if (start < TREND_LOOKBACK) return { dir: 'flat', move: 0, atr };
    const move = (cs[start - 1].c - cs[start - TREND_LOOKBACK].o) / atr;
    const dir = move <= -TREND_THRESHOLD ? 'down' : move >= TREND_THRESHOLD ? 'up' : 'flat';
    return { dir, move, atr };
  }

  // ---------- shared shape tests ----------

  const isDojiBody = (s) => s.body <= 0.1 * s.range;
  const isSmallBody = (s) => s.body > 0.1 * s.range && s.body <= 0.35 * s.range;
  // Close position within the range: 0 = at the low, 1 = at the high.
  const closePos = (k) => (k.c - k.l) / Math.max(k.h - k.l, 1e-12);
  // Monster Guide (p. 9, p. 16): close in the top (bottom) quarter, long wick about 2-3x the body.
  function hammerShape(k, a) {
    const s = shape(k);
    return isSmallBody(s) && s.lower >= 2 * s.body && s.lower >= 0.55 * s.range && s.upper <= 0.12 * s.range &&
      s.range >= 0.7 * a && closePos(k) >= 0.75;
  }
  function invertedShape(k, a) {
    const s = shape(k);
    return isSmallBody(s) && s.upper >= 2 * s.body && s.upper >= 0.55 * s.range && s.lower <= 0.12 * s.range &&
      s.range >= 0.7 * a && closePos(k) <= 0.25;
  }
  const isLongBody = (s, a) => s.body >= 0.6 * s.range && s.body >= 0.8 * a;

  // ---------- builders (generate an idealised, randomised instance) ----------

  function buildHammerLike(rng, last, inverted) {
    const b = R(rng, 0.22, 0.38);
    const longWick = b * R(rng, 2.6, 3.4) + 0.3;
    const tiny = R(rng, 0, 0.05);
    const o = last + R(rng, -0.05, 0.05);
    const c = o + (rng() < 0.5 ? b : -b);
    return [inverted ? mk(o, c, longWick, tiny) : mk(o, c, tiny, longWick)];
  }

  function longCandle(rng, open, dir) {
    const b = R(rng, 1.3, 1.8);
    return mk(open, open + dir * b, R(rng, 0.05, 0.2), R(rng, 0.05, 0.2));
  }

  // Shared two-candle tests, dir = 1 for bullish, -1 for bearish. j is the second candle.
  function haramiPair(cs, j, atr, dir) {
    const p = shape(cs[j - 1]);
    const s = shape(cs[j]);
    const outer = dir > 0 ? p.bear : p.bull;
    const inner = dir > 0 ? s.bull : s.bear;
    return outer && isLongBody(p, atr) && inner && s.bodyTop <= p.bodyTop && s.bodyBot >= p.bodyBot && s.body <= 0.5 * p.body;
  }
  function engulfPair(cs, j, atr, dir) {
    const p = shape(cs[j - 1]);
    const s = shape(cs[j]);
    const first = dir > 0 ? p.bear : p.bull;
    const second = dir > 0 ? s.bull : s.bear;
    return first && p.body >= 0.3 * atr && second && s.bodyBot <= p.bodyBot && s.bodyTop >= p.bodyTop && s.body > 1.1 * p.body;
  }
  // Rising (dir 1) / Falling (dir -1) Three Methods ending at i.
  function threeMethods(cs, i, atr, dir) {
    const a = cs[i - 4];
    const sa = shape(a);
    if (!(dir > 0 ? sa.bull : sa.bear) || !isLongBody(sa, atr)) return false;
    for (let j = i - 3; j <= i - 1; j++) {
      const s = shape(cs[j]);
      if (s.range > 0.6 * sa.range || s.body > 0.5 * sa.body || cs[j].h > a.h || cs[j].l < a.l) return false;
    }
    const e = shape(cs[i]);
    if (!(dir > 0 ? e.bull : e.bear) || e.body < 0.6 * e.range || e.body < 0.8 * atr) return false;
    return dir > 0 ? cs[i].c > a.h : cs[i].c < a.l;
  }
  function buildThreeMethods(rng, last, dir) {
    const a = mk(last, last + dir * R(rng, 1.5, 1.9), R(rng, 0.05, 0.15), R(rng, 0.05, 0.15));
    const out = [a];
    let o = a.c - dir * R(rng, 0.1, 0.2);
    for (let k = 0; k < 3; k++) {
      const c = o - dir * R(rng, -0.08, 0.3);
      out.push(mk(o, c, R(rng, 0.04, 0.12), R(rng, 0.04, 0.12)));
      o = c + R(rng, -0.03, 0.03);
    }
    const extreme = dir > 0 ? a.h : a.l;
    out.push(mk(o, extreme + dir * R(rng, 0.2, 0.45), R(rng, 0.04, 0.12), R(rng, 0.04, 0.12)));
    return out;
  }

  // ---------- pattern catalogue ----------
  // test(cs, i, ctx): i is the index of the LAST candle of the pattern.
  // ctx = { atr, trend } measured before the FIRST candle of the pattern.

  const PATTERNS = [
    {
      id: 'doji',
      name: 'Doji',
      group: 'single',
      candles: 1,
      signal: 'neutral',
      trend: null,
      confuse: ['spinning-top', 'dragonfly-doji', 'gravestone-doji'],
      rules: [
        'Open and close are almost equal (body ≤ 10% of the range)',
        'Wicks on both sides, each at least a quarter of the range',
      ],
      meaning:
        'Buyers and sellers ended the session in balance. After a strong run it warns that momentum is stalling; in a range it means little on its own.',
      confirm: 'Treat it as a pause signal. Act only on the next candle’s close in one direction.',
      test(cs, i, ctx) {
        const s = shape(cs[i]);
        return isDojiBody(s) && s.upper >= 0.25 * s.range && s.lower >= 0.25 * s.range && s.range >= 0.5 * ctx.atr;
      },
      build(rng, last) {
        const o = last + R(rng, -0.05, 0.05);
        const c = o + R(rng, -0.04, 0.04);
        const range = R(rng, 1.0, 1.6);
        const up = range * R(rng, 0.32, 0.62);
        return [mk(o, c, up, range - up - Math.abs(c - o))];
      },
    },
    {
      id: 'dragonfly-doji',
      name: 'Dragonfly Doji',
      group: 'single',
      candles: 1,
      signal: 'bullish',
      trend: 'down',
      confuse: ['hammer', 'doji', 'gravestone-doji'],
      rules: [
        'Appears after a decline',
        'Open, close and high are at nearly the same price',
        'Long lower wick (at least 70% of the range), no real upper wick',
      ],
      meaning:
        'Sellers drove price sharply lower, then buyers pushed it all the way back to the open. Rejection of lower prices at the bottom of a move.',
      confirm: 'Look for the next candle to close above the doji. Stops typically sit below the long wick.',
      test(cs, i, ctx) {
        const s = shape(cs[i]);
        return ctx.trend === 'down' && isDojiBody(s) && s.upper <= 0.1 * s.range && s.lower >= 0.7 * s.range && s.range >= 0.6 * ctx.atr;
      },
      build(rng, last) {
        const o = last + R(rng, -0.04, 0.04);
        const c = o + R(rng, -0.04, 0.04);
        return [mk(o, c, R(rng, 0, 0.05), R(rng, 1.2, 1.9))];
      },
    },
    {
      id: 'gravestone-doji',
      name: 'Gravestone Doji',
      group: 'single',
      candles: 1,
      signal: 'bearish',
      trend: 'up',
      confuse: ['shooting-star', 'doji', 'dragonfly-doji'],
      rules: [
        'Appears after a rally',
        'Open, close and low are at nearly the same price',
        'Long upper wick (at least 70% of the range), no real lower wick',
      ],
      meaning:
        'Buyers drove price well higher, but sellers pushed it all the way back to the open. Rejection of higher prices at the top of a move.',
      confirm: 'Look for the next candle to close below the doji. Stops typically sit above the long wick.',
      test(cs, i, ctx) {
        const s = shape(cs[i]);
        return ctx.trend === 'up' && isDojiBody(s) && s.lower <= 0.1 * s.range && s.upper >= 0.7 * s.range && s.range >= 0.6 * ctx.atr;
      },
      build(rng, last) {
        const o = last + R(rng, -0.04, 0.04);
        const c = o + R(rng, -0.04, 0.04);
        return [mk(o, c, R(rng, 1.2, 1.9), R(rng, 0, 0.05))];
      },
    },
    {
      id: 'hammer',
      name: 'Hammer',
      group: 'single',
      candles: 1,
      signal: 'bullish',
      trend: 'down',
      confuse: ['hanging-man', 'inverted-hammer', 'dragonfly-doji'],
      rules: [
        'Appears after a decline',
        'Small body; price closes in the top quarter of the range (either colour)',
        'Lower wick at least 2× the body, little or no upper wick',
      ],
      meaning:
        'Sellers pushed price well lower, but buyers drove it back up near the open. Selling pressure is fading at the lows.',
      confirm: 'Wait for a close above the hammer’s high. A common stop goes just below the hammer’s low.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && hammerShape(cs[i], ctx.atr);
      },
      build: (rng, last) => buildHammerLike(rng, last, false),
    },
    {
      id: 'hanging-man',
      name: 'Hanging Man',
      group: 'single',
      candles: 1,
      signal: 'bearish',
      trend: 'up',
      confuse: ['hammer', 'shooting-star', 'dragonfly-doji'],
      rules: [
        'Appears after a rally (same shape as a hammer, opposite context)',
        'Small body; price closes in the top quarter of the range',
        'Lower wick at least 2× the body, little or no upper wick',
      ],
      meaning:
        'Price sold off hard within the session before recovering. In an uptrend that dip shows sellers testing the market, an early warning the rally is tiring.',
      confirm: 'Needs a bearish close below the hanging man’s body on the next candle. Without it, the trend usually continues.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && hammerShape(cs[i], ctx.atr);
      },
      build: (rng, last) => buildHammerLike(rng, last, false),
    },
    {
      id: 'inverted-hammer',
      name: 'Inverted Hammer',
      group: 'single',
      candles: 1,
      signal: 'bullish',
      trend: 'down',
      confuse: ['shooting-star', 'hammer', 'gravestone-doji'],
      rules: [
        'Appears after a decline',
        'Small body; price closes in the bottom quarter of the range',
        'Upper wick at least 2× the body, little or no lower wick',
      ],
      meaning:
        'Buyers attempted a push higher at the lows. They didn’t hold it, but it is the first sign of demand after a sell-off.',
      confirm: 'Weaker than a hammer. Wait for the next candle to close above the inverted hammer’s body.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && invertedShape(cs[i], ctx.atr);
      },
      build: (rng, last) => buildHammerLike(rng, last, true),
    },
    {
      id: 'shooting-star',
      name: 'Shooting Star',
      group: 'single',
      candles: 1,
      signal: 'bearish',
      trend: 'up',
      confuse: ['inverted-hammer', 'gravestone-doji', 'hanging-man'],
      rules: [
        'Appears after a rally (same shape as an inverted hammer, opposite context)',
        'Small body; price closes in the bottom quarter of the range',
        'Upper wick at least 2× the body, little or no lower wick',
      ],
      meaning:
        'Buyers spiked price higher, then sellers slammed it back down to the open. Strong rejection of higher prices.',
      confirm: 'Look for the next candle to close below the shooting star’s body. Stops often go above the wick high.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && invertedShape(cs[i], ctx.atr);
      },
      build: (rng, last) => buildHammerLike(rng, last, true),
    },
    {
      id: 'spinning-top',
      name: 'Spinning Top',
      group: 'single',
      candles: 1,
      signal: 'neutral',
      trend: null,
      confuse: ['doji', 'hammer', 'shooting-star'],
      spot: false, // too common in ordinary price action to have one right answer
      rules: [
        'Small body (10–35% of the range), either colour',
        'Wicks on both sides, each at least a quarter of the range',
      ],
      meaning: 'Indecision: both sides pushed price around but neither won. Often seen as a trend loses momentum.',
      confirm: 'Not a trade signal alone. Use it as context and wait for the next decisive candle.',
      test(cs, i) {
        const s = shape(cs[i]);
        return isSmallBody(s) && s.upper >= 0.25 * s.range && s.lower >= 0.25 * s.range;
      },
      build(rng, last) {
        const o = last + R(rng, -0.05, 0.05);
        const b = R(rng, 0.2, 0.3);
        const c = o + (rng() < 0.5 ? b : -b);
        return [mk(o, c, R(rng, 0.45, 0.75), R(rng, 0.45, 0.75))];
      },
    },
    {
      id: 'bullish-marubozu',
      name: 'Bullish Marubozu',
      group: 'single',
      candles: 1,
      signal: 'bullish',
      trend: null,
      confuse: ['bearish-marubozu', 'bullish-engulfing', 'three-white-soldiers'],
      rules: [
        'Large bullish body, much bigger than recent candles',
        'Little or no wick on either side (body ≥ 90% of the range)',
      ],
      meaning: 'Buyers controlled the session from open to close. Shows strong momentum, often at a breakout.',
      confirm: 'Continuation is more likely when it breaks a level. Chasing after a very large one carries pullback risk.',
      test(cs, i, ctx) {
        const s = shape(cs[i]);
        return s.bull && s.body >= 0.9 * s.range && s.range >= 1.3 * ctx.atr;
      },
      build(rng, last) {
        const o = last + R(rng, -0.03, 0.03);
        return [mk(o, o + R(rng, 1.7, 2.3), R(rng, 0, 0.05), R(rng, 0, 0.05))];
      },
    },
    {
      id: 'bearish-marubozu',
      name: 'Bearish Marubozu',
      group: 'single',
      candles: 1,
      signal: 'bearish',
      trend: null,
      confuse: ['bullish-marubozu', 'bearish-engulfing', 'three-black-crows'],
      rules: [
        'Large bearish body, much bigger than recent candles',
        'Little or no wick on either side (body ≥ 90% of the range)',
      ],
      meaning: 'Sellers controlled the session from open to close. Shows strong downside momentum.',
      confirm: 'Continuation is more likely when it breaks support. Late entries risk a pullback.',
      test(cs, i, ctx) {
        const s = shape(cs[i]);
        return s.bear && s.body >= 0.9 * s.range && s.range >= 1.3 * ctx.atr;
      },
      build(rng, last) {
        const o = last + R(rng, -0.03, 0.03);
        return [mk(o, o - R(rng, 1.7, 2.3), R(rng, 0, 0.05), R(rng, 0, 0.05))];
      },
    },
    {
      id: 'bullish-engulfing',
      name: 'Bullish Engulfing',
      group: 'double',
      candles: 2,
      signal: 'bullish',
      trend: 'down',
      confuse: ['piercing-line', 'three-outside-up', 'tweezer-bottom'],
      rules: [
        'Appears after a decline',
        'Candle 1 is bearish',
        'Candle 2 is bullish and its body covers all of candle 1’s body',
      ],
      meaning: 'Buyers fully reversed the prior session’s selling. One of the more reliable two-candle reversal signals.',
      confirm: 'Stronger at support or a round number. A common stop goes below the low of the two candles.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'down' && p.bear && p.body >= 0.3 * ctx.atr && s.bull &&
          cs[i].o <= cs[i - 1].c && cs[i].c >= cs[i - 1].o && s.body > 1.1 * p.body
        );
      },
      build(rng, last) {
        const p = mk(last, last - R(rng, 0.45, 0.75), R(rng, 0.05, 0.2), R(rng, 0.03, 0.1));
        const o = p.c - R(rng, 0, 0.05);
        const s = mk(o, p.o + R(rng, 0.2, 0.5), R(rng, 0.12, 0.25), R(rng, 0.25, 0.4));
        return [p, s];
      },
    },
    {
      id: 'bearish-engulfing',
      name: 'Bearish Engulfing',
      group: 'double',
      candles: 2,
      signal: 'bearish',
      trend: 'up',
      confuse: ['dark-cloud-cover', 'three-outside-down', 'tweezer-top'],
      rules: [
        'Appears after a rally',
        'Candle 1 is bullish',
        'Candle 2 is bearish and its body covers all of candle 1’s body',
      ],
      meaning: 'Sellers fully reversed the prior session’s buying. One of the more reliable two-candle reversal signals.',
      confirm: 'Stronger at resistance. A common stop goes above the high of the two candles.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'up' && p.bull && p.body >= 0.3 * ctx.atr && s.bear &&
          cs[i].o >= cs[i - 1].c && cs[i].c <= cs[i - 1].o && s.body > 1.1 * p.body
        );
      },
      build(rng, last) {
        const p = mk(last, last + R(rng, 0.45, 0.75), R(rng, 0.03, 0.1), R(rng, 0.05, 0.2));
        const o = p.c + R(rng, 0, 0.05);
        const s = mk(o, p.o - R(rng, 0.2, 0.5), R(rng, 0.25, 0.4), R(rng, 0.12, 0.25));
        return [p, s];
      },
    },
    {
      id: 'bullish-harami',
      name: 'Bullish Harami',
      group: 'double',
      candles: 2,
      signal: 'bullish',
      trend: 'down',
      confuse: ['bullish-engulfing', 'three-inside-up', 'morning-star'],
      rules: [
        'Appears after a decline',
        'Candle 1 is a long bearish candle',
        'Candle 2 is a small bullish body sitting inside candle 1’s body',
      ],
      meaning: '“Harami” means pregnant. The selling stalled and the market went quiet inside the prior range, a first hint of reversal.',
      confirm: 'Weaker than engulfing. Wait for a close above candle 1’s open or a nearby resistance level.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'down' && p.bear && isLongBody(p, ctx.atr) && s.bull &&
          s.bodyTop <= cs[i - 1].o && s.bodyBot >= cs[i - 1].c && s.body <= 0.5 * p.body
        );
      },
      build(rng, last) {
        const p = longCandle(rng, last, -1);
        const pb = p.o - p.c;
        const o = p.c + pb * R(rng, 0.15, 0.3);
        const s = mk(o, o + pb * R(rng, 0.2, 0.38), R(rng, 0.05, 0.15), R(rng, 0.05, 0.15));
        return [p, s];
      },
    },
    {
      id: 'bearish-harami',
      name: 'Bearish Harami',
      group: 'double',
      candles: 2,
      signal: 'bearish',
      trend: 'up',
      confuse: ['bearish-engulfing', 'three-inside-down', 'evening-star'],
      rules: [
        'Appears after a rally',
        'Candle 1 is a long bullish candle',
        'Candle 2 is a small bearish body sitting inside candle 1’s body',
      ],
      meaning: 'The buying stalled and the market went quiet inside the prior range, a first hint the rally is done.',
      confirm: 'Weaker than engulfing. Wait for a close below candle 1’s open or a nearby support level.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'up' && p.bull && isLongBody(p, ctx.atr) && s.bear &&
          s.bodyTop <= cs[i - 1].c && s.bodyBot >= cs[i - 1].o && s.body <= 0.5 * p.body
        );
      },
      build(rng, last) {
        const p = longCandle(rng, last, 1);
        const pb = p.c - p.o;
        const o = p.c - pb * R(rng, 0.15, 0.3);
        const s = mk(o, o - pb * R(rng, 0.2, 0.38), R(rng, 0.05, 0.15), R(rng, 0.05, 0.15));
        return [p, s];
      },
    },
    {
      id: 'piercing-line',
      name: 'Piercing Line',
      group: 'double',
      candles: 2,
      signal: 'bullish',
      trend: 'down',
      confuse: ['bullish-engulfing', 'dark-cloud-cover', 'bullish-harami'],
      rules: [
        'Appears after a decline',
        'Candle 1 is a long bearish candle',
        'Candle 2 opens at or below candle 1’s close and closes above the midpoint of candle 1’s body, but not above its open',
      ],
      meaning: 'Buyers recovered more than half of the prior session’s losses. A reversal attempt that falls just short of engulfing.',
      confirm: 'In forex, opening gaps are rare, so judge it on how deep the close pierces. Confirm with a higher close next.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        const a = cs[i - 1];
        return (
          ctx.trend === 'down' && p.bear && isLongBody(p, ctx.atr) && s.bull &&
          cs[i].o <= a.c && cs[i].c > a.c + 0.5 * p.body && cs[i].c < a.o
        );
      },
      build(rng, last) {
        const p = longCandle(rng, last, -1);
        const pb = p.o - p.c;
        const o = p.c - R(rng, 0, 0.08);
        const s = mk(o, p.c + pb * R(rng, 0.58, 0.85), R(rng, 0.12, 0.25), R(rng, 0.3, 0.45));
        return [p, s];
      },
    },
    {
      id: 'dark-cloud-cover',
      name: 'Dark Cloud Cover',
      group: 'double',
      candles: 2,
      signal: 'bearish',
      trend: 'up',
      confuse: ['bearish-engulfing', 'piercing-line', 'bearish-harami'],
      rules: [
        'Appears after a rally',
        'Candle 1 is a long bullish candle',
        'Candle 2 opens at or above candle 1’s close and closes below the midpoint of candle 1’s body, but not below its open',
      ],
      meaning: 'Sellers erased more than half of the prior session’s gains. A reversal attempt that falls just short of engulfing.',
      confirm: 'Judge it on how deep the close cuts into candle 1. Confirm with a lower close next.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        const a = cs[i - 1];
        return (
          ctx.trend === 'up' && p.bull && isLongBody(p, ctx.atr) && s.bear &&
          cs[i].o >= a.c && cs[i].c < a.c - 0.5 * p.body && cs[i].c > a.o
        );
      },
      build(rng, last) {
        const p = longCandle(rng, last, 1);
        const pb = p.c - p.o;
        const o = p.c + R(rng, 0, 0.08);
        const s = mk(o, p.c - pb * R(rng, 0.58, 0.85), R(rng, 0.3, 0.45), R(rng, 0.12, 0.25));
        return [p, s];
      },
    },
    {
      id: 'tweezer-bottom',
      name: 'Tweezer Bottom',
      group: 'double',
      candles: 2,
      signal: 'bullish',
      trend: 'down',
      confuse: ['tweezer-top', 'bullish-engulfing', 'piercing-line'],
      rules: [
        'Appears after a decline',
        'Candle 1 shows rejection of lower prices (lower wick ≥ 25% of its range)',
        'Candle 2 re-tests the same low (within 5% of an average range) and closes bullish',
      ],
      meaning: 'Price tested the same low twice and was rejected both times. That level is acting as support.',
      confirm: 'A close above candle 1’s open confirms it. A stop just under the shared low is common.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'down' && p.lower >= 0.25 * p.range && p.range >= 0.6 * ctx.atr && s.bull && s.body >= 0.2 * ctx.atr &&
          Math.abs(cs[i - 1].l - cs[i].l) <= 0.05 * ctx.atr
        );
      },
      build(rng, last) {
        const p = mk(last, last - R(rng, 1.0, 1.3), R(rng, 0.03, 0.1), R(rng, 0.42, 0.55));
        const pb = p.o - p.c;
        const o = p.c - R(rng, 0.01, 0.05);
        const c = o + pb * R(rng, 0.38, 0.47);
        const s = { o, c, h: c + R(rng, 0.05, 0.15), l: p.l + R(rng, -0.02, 0.02) };
        return [p, s];
      },
    },
    {
      id: 'tweezer-top',
      name: 'Tweezer Top',
      group: 'double',
      candles: 2,
      signal: 'bearish',
      trend: 'up',
      confuse: ['tweezer-bottom', 'bearish-engulfing', 'dark-cloud-cover'],
      rules: [
        'Appears after a rally',
        'Candle 1 shows rejection of higher prices (upper wick ≥ 25% of its range)',
        'Candle 2 re-tests the same high (within 5% of an average range) and closes bearish',
      ],
      meaning: 'Price tested the same high twice and was rejected both times. That level is acting as resistance.',
      confirm: 'A close below candle 1’s open confirms it. A stop just above the shared high is common.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'up' && p.upper >= 0.25 * p.range && p.range >= 0.6 * ctx.atr && s.bear && s.body >= 0.2 * ctx.atr &&
          Math.abs(cs[i - 1].h - cs[i].h) <= 0.05 * ctx.atr
        );
      },
      build(rng, last) {
        const p = mk(last, last + R(rng, 1.0, 1.3), R(rng, 0.42, 0.55), R(rng, 0.03, 0.1));
        const pb = p.c - p.o;
        const o = p.c + R(rng, 0.01, 0.05);
        const c = o - pb * R(rng, 0.38, 0.47);
        const s = { o, c, h: p.h + R(rng, -0.02, 0.02), l: c - R(rng, 0.05, 0.15) };
        return [p, s];
      },
    },
    {
      id: 'morning-star',
      name: 'Morning Star',
      group: 'triple',
      candles: 3,
      signal: 'bullish',
      trend: 'down',
      confuse: ['evening-star', 'bullish-harami', 'three-white-soldiers'],
      rules: [
        'Appears after a decline',
        'Candle 1 is a long bearish candle',
        'Candle 2 is small (body ≤ 30% and range ≤ 60% of candle 1’s) and sits at or below candle 1’s close',
        'Candle 3 is bullish and closes above the midpoint of candle 1’s body',
      ],
      meaning: 'Selling, then hesitation, then a strong buying session. The three-step sequence shows control passing from sellers to buyers.',
      confirm: 'Forex rarely gaps, so the small middle body just needs to sit at the low. A stop below candle 2’s low is common.',
      test(cs, i, ctx) {
        const q = shape(cs[i - 2]);
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        const a = cs[i - 2];
        return (
          ctx.trend === 'down' && q.bear && isLongBody(q, ctx.atr) && p.body <= 0.3 * q.body && p.range <= 0.6 * q.range &&
          p.bodyTop <= a.c + 0.1 * q.body && s.bull && cs[i].c >= a.c + 0.5 * q.body
        );
      },
      build(rng, last) {
        const q = longCandle(rng, last, -1);
        const qb = q.o - q.c;
        const po = q.c - R(rng, 0.05, 0.15);
        const pc = po + R(rng, -0.12, 0.12);
        const p = mk(po, pc, R(rng, 0.08, 0.25), R(rng, 0.08, 0.25));
        const so = pc + R(rng, -0.03, 0.03);
        const s = mk(so, q.c + qb * R(rng, 0.6, 0.9), R(rng, 0.15, 0.28), R(rng, 0.12, 0.25));
        return [q, p, s];
      },
    },
    {
      id: 'evening-star',
      name: 'Evening Star',
      group: 'triple',
      candles: 3,
      signal: 'bearish',
      trend: 'up',
      confuse: ['morning-star', 'bearish-harami', 'three-black-crows'],
      rules: [
        'Appears after a rally',
        'Candle 1 is a long bullish candle',
        'Candle 2 is small (body ≤ 30% and range ≤ 60% of candle 1’s) and sits at or above candle 1’s close',
        'Candle 3 is bearish and closes below the midpoint of candle 1’s body',
      ],
      meaning: 'Buying, then hesitation, then a strong selling session. Control passes from buyers to sellers at the top.',
      confirm: 'The small middle body just needs to sit at the high. A stop above candle 2’s high is common.',
      test(cs, i, ctx) {
        const q = shape(cs[i - 2]);
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        const a = cs[i - 2];
        return (
          ctx.trend === 'up' && q.bull && isLongBody(q, ctx.atr) && p.body <= 0.3 * q.body && p.range <= 0.6 * q.range &&
          p.bodyBot >= a.c - 0.1 * q.body && s.bear && cs[i].c <= a.c - 0.5 * q.body
        );
      },
      build(rng, last) {
        const q = longCandle(rng, last, 1);
        const qb = q.c - q.o;
        const po = q.c + R(rng, 0.05, 0.15);
        const pc = po + R(rng, -0.12, 0.12);
        const p = mk(po, pc, R(rng, 0.08, 0.25), R(rng, 0.08, 0.25));
        const so = pc + R(rng, -0.03, 0.03);
        const s = mk(so, q.c - qb * R(rng, 0.6, 0.9), R(rng, 0.12, 0.25), R(rng, 0.15, 0.28));
        return [q, p, s];
      },
    },
    {
      id: 'three-white-soldiers',
      name: 'Three White Soldiers',
      group: 'triple',
      candles: 3,
      signal: 'bullish',
      trend: 'down',
      confuse: ['three-black-crows', 'morning-star', 'bullish-marubozu'],
      rules: [
        'Appears after a decline or a base',
        'Three bullish candles in a row with solid bodies (≥ 60% of range)',
        'Each opens inside the previous body and closes higher',
        'Small upper wicks: buyers held the highs',
      ],
      meaning: 'Three sessions of steady, committed buying. A strong reversal that often starts a new up-leg.',
      confirm: 'After three big candles price is often stretched. Many traders wait for a shallow pullback to enter.',
      test(cs, i, ctx) {
        if (ctx.trend !== 'down') return false;
        for (let j = i - 2; j <= i; j++) {
          const s = shape(cs[j]);
          if (!s.bull || s.body < 0.6 * s.range || s.body < 0.6 * ctx.atr || s.upper > 0.25 * s.range) return false;
          if (j > i - 2) {
            const prev = cs[j - 1];
            if (cs[j].c <= prev.c || cs[j].o < prev.o || cs[j].o > prev.c) return false;
          }
        }
        return true;
      },
      build(rng, last) {
        const out = [];
        let o = last;
        for (let k = 0; k < 3; k++) {
          const b = R(rng, 0.95, 1.3);
          const k1 = mk(o, o + b, R(rng, 0.1, 0.22), R(rng, 0.1, 0.22));
          out.push(k1);
          o = k1.c - b * R(rng, 0, 0.25);
        }
        return out;
      },
    },
    {
      id: 'three-black-crows',
      name: 'Three Black Crows',
      group: 'triple',
      candles: 3,
      signal: 'bearish',
      trend: 'up',
      confuse: ['three-white-soldiers', 'evening-star', 'bearish-marubozu'],
      rules: [
        'Appears after a rally',
        'Three bearish candles in a row with solid bodies (≥ 60% of range)',
        'Each opens inside the previous body and closes lower',
        'Small lower wicks: sellers held the lows',
      ],
      meaning: 'Three sessions of steady, committed selling. A strong reversal that often starts a new down-leg.',
      confirm: 'Price is often stretched after three big candles. Many traders wait for a weak bounce to enter.',
      test(cs, i, ctx) {
        if (ctx.trend !== 'up') return false;
        for (let j = i - 2; j <= i; j++) {
          const s = shape(cs[j]);
          if (!s.bear || s.body < 0.6 * s.range || s.body < 0.6 * ctx.atr || s.lower > 0.25 * s.range) return false;
          if (j > i - 2) {
            const prev = cs[j - 1];
            if (cs[j].c >= prev.c || cs[j].o > prev.o || cs[j].o < prev.c) return false;
          }
        }
        return true;
      },
      build(rng, last) {
        const out = [];
        let o = last;
        for (let k = 0; k < 3; k++) {
          const b = R(rng, 0.95, 1.3);
          const k1 = mk(o, o - b, R(rng, 0.1, 0.22), R(rng, 0.1, 0.22));
          out.push(k1);
          o = k1.c + b * R(rng, 0, 0.25);
        }
        return out;
      },
    },
    {
      id: 'three-inside-up',
      name: 'Three Inside Up',
      group: 'triple',
      candles: 3,
      signal: 'bullish',
      trend: 'down',
      confuse: ['bullish-harami', 'three-outside-up', 'morning-star'],
      rules: [
        'Appears after a decline',
        'Candle 1 is a long bearish candle',
        'Candle 2 is a small bullish body inside candle 1’s body (a bullish harami)',
        'Candle 3 is bullish and closes above candle 2’s close',
      ],
      meaning: 'A bullish harami followed by a second up-close. The pause in selling has already had one session of follow-through from buyers.',
      confirm: 'It signals later than the harami alone, in exchange for confirmation. A stop below candle 1’s low is common.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && haramiPair(cs, i - 1, ctx.atr, 1) && cs[i].c > cs[i].o && cs[i].c > cs[i - 1].c;
      },
      build(rng, last) {
        const q = longCandle(rng, last, -1);
        const qb = q.o - q.c;
        const po = q.c + qb * R(rng, 0.12, 0.25);
        const p = mk(po, po + qb * R(rng, 0.18, 0.3), R(rng, 0.05, 0.12), R(rng, 0.05, 0.12));
        const so = p.c + R(rng, -0.03, 0.03);
        const s = mk(so, so + R(rng, 0.45, 0.8), R(rng, 0.1, 0.22), R(rng, 0.08, 0.2));
        return [q, p, s];
      },
    },
    {
      id: 'three-inside-down',
      name: 'Three Inside Down',
      group: 'triple',
      candles: 3,
      signal: 'bearish',
      trend: 'up',
      confuse: ['bearish-harami', 'three-outside-down', 'evening-star'],
      rules: [
        'Appears after a rally',
        'Candle 1 is a long bullish candle',
        'Candle 2 is a small bearish body inside candle 1’s body (a bearish harami)',
        'Candle 3 is bearish and closes below candle 2’s close',
      ],
      meaning: 'A bearish harami followed by a second down-close. The stall in buying has already had one session of follow-through from sellers.',
      confirm: 'It signals later than the harami alone, in exchange for confirmation. A stop above candle 1’s high is common.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && haramiPair(cs, i - 1, ctx.atr, -1) && cs[i].c < cs[i].o && cs[i].c < cs[i - 1].c;
      },
      build(rng, last) {
        const q = longCandle(rng, last, 1);
        const qb = q.c - q.o;
        const po = q.c - qb * R(rng, 0.12, 0.25);
        const p = mk(po, po - qb * R(rng, 0.18, 0.3), R(rng, 0.05, 0.12), R(rng, 0.05, 0.12));
        const so = p.c + R(rng, -0.03, 0.03);
        const s = mk(so, so - R(rng, 0.45, 0.8), R(rng, 0.08, 0.2), R(rng, 0.1, 0.22));
        return [q, p, s];
      },
    },
    {
      id: 'three-outside-up',
      name: 'Three Outside Up',
      group: 'triple',
      candles: 3,
      signal: 'bullish',
      trend: 'down',
      confuse: ['bullish-engulfing', 'three-inside-up', 'three-white-soldiers'],
      rules: [
        'Appears after a decline',
        'Candle 1 is bearish',
        'Candle 2 is bullish and its body engulfs candle 1’s body (a bullish engulfing)',
        'Candle 3 is bullish and closes above candle 2’s close',
      ],
      meaning: 'An engulfing reversal followed by another higher close, so the shift to buyers has been confirmed once already.',
      confirm: 'Entries after candle 3 are further from the low, so the stop below the pattern is wider. Size the position for that.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && engulfPair(cs, i - 1, ctx.atr, 1) && cs[i].c > cs[i].o && cs[i].c > cs[i - 1].c;
      },
      build(rng, last) {
        const q = mk(last, last - R(rng, 0.45, 0.75), R(rng, 0.05, 0.2), R(rng, 0.03, 0.1));
        const po = q.c - R(rng, 0, 0.05);
        const p = mk(po, q.o + R(rng, 0.2, 0.45), R(rng, 0.12, 0.25), R(rng, 0.25, 0.4));
        const so = p.c + R(rng, -0.03, 0.03);
        const s = mk(so, so + R(rng, 0.4, 0.7), R(rng, 0.1, 0.22), R(rng, 0.1, 0.2));
        return [q, p, s];
      },
    },
    {
      id: 'three-outside-down',
      name: 'Three Outside Down',
      group: 'triple',
      candles: 3,
      signal: 'bearish',
      trend: 'up',
      confuse: ['bearish-engulfing', 'three-inside-down', 'three-black-crows'],
      rules: [
        'Appears after a rally',
        'Candle 1 is bullish',
        'Candle 2 is bearish and its body engulfs candle 1’s body (a bearish engulfing)',
        'Candle 3 is bearish and closes below candle 2’s close',
      ],
      meaning: 'An engulfing reversal followed by another lower close, so the shift to sellers has been confirmed once already.',
      confirm: 'Entries after candle 3 are further from the high, so the stop above the pattern is wider. Size the position for that.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && engulfPair(cs, i - 1, ctx.atr, -1) && cs[i].c < cs[i].o && cs[i].c < cs[i - 1].c;
      },
      build(rng, last) {
        const q = mk(last, last + R(rng, 0.45, 0.75), R(rng, 0.03, 0.1), R(rng, 0.05, 0.2));
        const po = q.c + R(rng, 0, 0.05);
        const p = mk(po, q.o - R(rng, 0.2, 0.45), R(rng, 0.25, 0.4), R(rng, 0.12, 0.25));
        const so = p.c + R(rng, -0.03, 0.03);
        const s = mk(so, so - R(rng, 0.4, 0.7), R(rng, 0.1, 0.2), R(rng, 0.1, 0.22));
        return [q, p, s];
      },
    },
    {
      id: 'rising-three-methods',
      name: 'Rising Three Methods',
      group: 'multi',
      candles: 5,
      signal: 'bullish',
      trend: 'up',
      confuse: ['falling-three-methods', 'bullish-harami', 'three-white-soldiers'],
      rules: [
        'Appears during an uptrend',
        'Candle 1 is a large bullish candle',
        'Candles 2–4 have smaller ranges and bodies and stay inside candle 1’s range',
        'Candle 5 is a large bullish candle that closes above candle 1’s high',
      ],
      meaning:
        'Buyers paused to take profit, but the pullback was shallow and stayed inside the first candle. The fifth candle resumes the trend at a new high. It is the candlestick version of a bull flag.',
      confirm: 'The Monster Guide uses it after a breakout above resistance: wait for the pattern, then buy the break of its high.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && threeMethods(cs, i, ctx.atr, 1);
      },
      build: (rng, last) => buildThreeMethods(rng, last, 1),
    },
    {
      id: 'falling-three-methods',
      name: 'Falling Three Methods',
      group: 'multi',
      candles: 5,
      signal: 'bearish',
      trend: 'down',
      confuse: ['rising-three-methods', 'bearish-harami', 'three-black-crows'],
      rules: [
        'Appears during a downtrend',
        'Candle 1 is a large bearish candle',
        'Candles 2–4 have smaller ranges and bodies and stay inside candle 1’s range',
        'Candle 5 is a large bearish candle that closes below candle 1’s low',
      ],
      meaning:
        'Sellers paused to take profit, but the bounce was shallow and stayed inside the first candle. The fifth candle resumes the decline at a new low. It is the candlestick version of a bear flag.',
      confirm: 'The Monster Guide uses it after a breakdown below support: wait for the pattern, then sell the break of its low.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && threeMethods(cs, i, ctx.atr, -1);
      },
      build: (rng, last) => buildThreeMethods(rng, last, -1),
    },
  ];

  const BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

  // ---------- detection ----------

  function contextFor(cs, i, def) {
    const start = i - def.candles + 1;
    const t = trendInto(cs, start);
    return { atr: t.atr, trend: t.dir, move: t.move, start };
  }

  function matches(cs, i, id) {
    const def = BY_ID[id];
    if (!def || i - def.candles + 1 < 1 || i >= cs.length) return false;
    return def.test(cs, i, contextFor(cs, i, def));
  }

  // All pattern ids whose final candle is at index i.
  function detectAt(cs, i) {
    return PATTERNS.filter((p) => matches(cs, i, p.id)).map((p) => p.id);
  }

  // ---------- markets ----------

  const PAIRS = [
    { symbol: 'EUR/USD', base: 1.085, dp: 5, pip: 0.0001 },
    { symbol: 'GBP/USD', base: 1.272, dp: 5, pip: 0.0001 },
    { symbol: 'AUD/USD', base: 0.662, dp: 5, pip: 0.0001 },
    { symbol: 'USD/CAD', base: 1.364, dp: 5, pip: 0.0001 },
    { symbol: 'USD/CHF', base: 0.884, dp: 5, pip: 0.0001 },
    { symbol: 'USD/JPY', base: 149.6, dp: 3, pip: 0.01 },
    { symbol: 'EUR/JPY', base: 162.3, dp: 3, pip: 0.01 },
  ];
  // Typical average candle range in pips per timeframe (major pairs).
  const TIMEFRAMES = [
    { tf: 'H1', atrPips: 14, minutes: 60 },
    { tf: 'H4', atrPips: 32, minutes: 240 },
    { tf: 'D1', atrPips: 75, minutes: 1440 },
  ];

  // ---------- synthetic chart generation ----------

  function series(rng, start, n, drift) {
    const out = [];
    let last = start;
    for (let k = 0; k < n; k++) {
      const pull = drift === 0 ? -0.12 * (last - start) : 0;
      const o = last + R(rng, -0.03, 0.03);
      const c = o + drift + pull + R(rng, -0.55, 0.55);
      out.push(mk(o, c, R(rng, 0.08, 0.4), R(rng, 0.08, 0.4)));
      last = c;
    }
    return out;
  }

  const DRIFT = { up: 0.45, down: -0.45, flat: 0 };

  function toMarket(rng, raw, extra = []) {
    const pair = pick(rng, PAIRS);
    const tf = pick(rng, TIMEFRAMES);
    const scale = tf.atrPips * pair.pip;
    const base = pair.base * (1 + R(rng, -0.015, 0.015));
    const f = 10 ** pair.dp;
    const round = (x) => Math.round((base + x * scale) * f) / f;
    const candles = raw.map((k) => ({ o: round(k.o), h: round(k.h), l: round(k.l), c: round(k.c) }));
    return { pair, tf, candles, extra: extra.map(round) };
  }

  function trendFor(rng, def) {
    return def.trend || pick(rng, ['up', 'down', 'flat']);
  }

  // Chart that ends exactly on the target pattern (Drill mode).
  function generateDrill(id, rng, opts = {}) {
    const def = BY_ID[id];
    if (!def) throw new Error('Unknown pattern: ' + id);
    const length = opts.length || 28;
    for (let attempt = 0; attempt < 400; attempt++) {
      const trend = trendFor(rng, def);
      const nTrend = 9;
      const filler = series(rng, 0, Math.max(3, length - nTrend - def.candles), 0);
      const t = series(rng, filler[filler.length - 1].c, nTrend, DRIFT[trend]);
      const pat = def.build(rng, t[t.length - 1].c);
      const m = toMarket(rng, filler.concat(t, pat));
      const i = m.candles.length - 1;
      if (matches(m.candles, i, id)) {
        return { ...m, id, index: i, start: i - def.candles + 1, matches: detectAt(m.candles, i), attempts: attempt + 1 };
      }
    }
    throw new Error('Could not generate pattern: ' + id);
  }

  // Chart with the target pattern somewhere in the middle, followed by a few
  // candles of aftermath, and nowhere else (Spot mode).
  function generateSpot(id, rng, opts = {}) {
    const def = BY_ID[id];
    if (!def) throw new Error('Unknown pattern: ' + id);
    for (let attempt = 0; attempt < 600; attempt++) {
      const trend = trendFor(rng, def);
      const nFill = 8 + Math.floor(rng() * 9);
      const nAfter = 4 + Math.floor(rng() * 5);
      const filler = series(rng, 0, nFill, 0);
      const t = series(rng, filler[filler.length - 1].c, 8, DRIFT[trend]);
      const pat = def.build(rng, t[t.length - 1].c);
      const dir = def.signal === 'bullish' ? 0.35 : def.signal === 'bearish' ? -0.35 : 0;
      const after = series(rng, pat[pat.length - 1].c, nAfter, dir);
      const m = toMarket(rng, filler.concat(t, pat, after));
      const i = filler.length + t.length + pat.length - 1;
      if (!matches(m.candles, i, id)) continue;
      let unique = true;
      for (let j = 1; j < m.candles.length && unique; j++) if (j !== i && matches(m.candles, j, id)) unique = false;
      if (!unique) continue;
      return { ...m, id, index: i, start: i - def.candles + 1, attempts: attempt + 1 };
    }
    throw new Error('Could not generate spot chart: ' + id);
  }

  // Measured facts about a pattern instance, for feedback.
  function explain(cs, i, id) {
    const def = BY_ID[id];
    const ctx = contextFor(cs, i, def);
    const candles = [];
    for (let j = ctx.start; j <= i; j++) {
      const s = shape(cs[j]);
      candles.push({
        index: j,
        colour: s.bull ? 'bullish' : s.bear ? 'bearish' : 'flat',
        bodyPct: Math.round((100 * s.body) / s.range),
        upperPct: Math.round((100 * s.upper) / s.range),
        lowerPct: Math.round((100 * s.lower) / s.range),
        rangeAtr: +(s.range / ctx.atr).toFixed(2),
      });
    }
    return { trend: ctx.trend, move: +ctx.move.toFixed(2), candles };
  }

  // ---------- sources ----------
  // Every rule above is traceable to at least one of these documents (or to the
  // standard definition where a document only lists the name). Disagreements
  // between them are recorded in `notes` rather than silently resolved.

  const SOURCES = {
    MG: {
      short: 'Monster Guide',
      title: 'The Monster Guide to Candlestick Patterns',
      author: 'Rayner Teo (TradingwithRayner)',
      loc: 'page',
    },
    TP: {
      short: '58 Patterns',
      title: '58 Candlestick Patterns PDF Manual',
      author: 'tradingpdf.net (printed 25 Dec 2023)',
      loc: 'entry',
    },
  };

  const MG_HARAMI =
    'The Monster Guide disagrees with the classic reading: Rayner Teo argues the harami works better as a continuation pattern (a large candle in the trend direction, then a small inside candle) and treats it like an inside bar. This trainer tests the classic reversal form, which most references use.';
  const GAP_NOTE = (side) =>
    `The 58-pattern manual gives the classic stock-market rule: candle 2 opens ${side}. Spot FX trades around the clock, so that gap almost never forms. This trainer follows the Monster Guide’s version, which has no gap requirement.`;

  const META = {
    doji: { role: 'indecision', refs: [['MG', 23], ['TP', 9]], notes: ['The Monster Guide places the open and close around the middle of the range. This trainer checks that with a wick of at least 25% on each side.'] },
    'dragonfly-doji': { role: 'reversal', refs: [['MG', 23], ['TP', 7]] },
    'gravestone-doji': { role: 'reversal', refs: [['MG', 24], ['TP', 6]] },
    hammer: { role: 'reversal', refs: [['MG', 9], ['TP', 14]], notes: ['The “top quarter” close and the 2–3× wick come from the Monster Guide.'] },
    'hanging-man': { role: 'reversal', refs: [['TP', 15]], notes: ['Not in the Monster Guide. The 58-pattern manual defines it as the hammer shape appearing at the end of an uptrend.'] },
    'inverted-hammer': { role: 'reversal', refs: [['TP', 5]] },
    'shooting-star': { role: 'reversal', refs: [['MG', 16], ['TP', 4]], notes: ['The “bottom quarter” close and the 2–3× wick come from the Monster Guide.'] },
    'spinning-top': { role: 'indecision', refs: [['MG', 22], ['TP', 10]] },
    'bullish-marubozu': { role: 'continuation', refs: [['TP', 2]], notes: ['The 58-pattern manual treats a marubozu as a continuation signal in the direction of the candle.'] },
    'bearish-marubozu': { role: 'continuation', refs: [['TP', 1]], notes: ['The 58-pattern manual treats a marubozu as a continuation signal in the direction of the candle.'] },
    'bullish-engulfing': { role: 'reversal', refs: [['MG', 10], ['TP', 25]], notes: ['Both sources compare bodies only and ignore the wicks.'] },
    'bearish-engulfing': { role: 'reversal', refs: [['MG', 17], ['TP', 24]], notes: ['Both sources compare bodies only and ignore the wicks.'] },
    'bullish-harami': { role: 'reversal', refs: [['MG', 27]], notes: [MG_HARAMI] },
    'bearish-harami': { role: 'reversal', refs: [['MG', 28]], notes: [MG_HARAMI] },
    'piercing-line': { role: 'reversal', refs: [['MG', 11], ['TP', 26]], notes: [GAP_NOTE('below candle 1’s low')] },
    'dark-cloud-cover': { role: 'reversal', refs: [['MG', 18], ['TP', 23]], notes: [GAP_NOTE('above candle 1’s high')] },
    'tweezer-bottom': { role: 'reversal', refs: [['MG', 12]], notes: ['Rules follow the Monster Guide. This is not the 58-pattern manual’s Matching Low, which compares the closes of two bearish candles.'] },
    'tweezer-top': { role: 'reversal', refs: [['MG', 18]] },
    'morning-star': { role: 'reversal', refs: [['MG', 13], ['TP', 33]], notes: ['The manual’s Morning Doji Star needs a doji that gaps below candle 1. The Monster Guide only asks for a small-range middle candle, which suits gap-free forex charts, so that is the rule used here.'] },
    'evening-star': { role: 'reversal', refs: [['MG', 19], ['TP', 34]], notes: ['The manual’s Evening Doji Star needs a doji that gaps above candle 1. The Monster Guide only asks for a small-range middle candle, so that is the rule used here.'] },
    'three-white-soldiers': { role: 'reversal', refs: [], notes: ['Named in the 58-pattern manual’s list, but its entry falls beyond the pages in the PDF. Rules follow the standard definition, mirroring the manual’s Three Black Crows (#35).'] },
    'three-black-crows': { role: 'reversal', refs: [['TP', 35]] },
    'three-inside-up': { role: 'reversal', refs: [['TP', 38]], notes: ['Many references require candle 3 to close above candle 1’s open. The manual only requires a close above candle 2’s close, and that is the rule tested here.'] },
    'three-inside-down': { role: 'reversal', refs: [['TP', 37]], notes: ['Many references require candle 3 to close below candle 1’s open. The manual only requires a close below candle 2’s close, and that is the rule tested here.'] },
    'three-outside-up': { role: 'reversal', refs: [['TP', 40]] },
    'three-outside-down': { role: 'reversal', refs: [['TP', 41]] },
    'rising-three-methods': { role: 'continuation', refs: [['MG', 25]], notes: ['The Monster Guide only says candles 2–4 are smaller. Keeping them inside candle 1’s range is the classic rule, added so the pattern is unambiguous.'] },
    'falling-three-methods': { role: 'continuation', refs: [['MG', 26]], notes: ['The Monster Guide only says candles 2–4 are smaller. Keeping them inside candle 1’s range is the classic rule, added so the pattern is unambiguous.'] },
  };
  for (const p of PATTERNS) {
    const m = META[p.id] || {};
    p.role = m.role || 'reversal';
    p.refs = (m.refs || []).map(([src, n]) => ({ src, n }));
    p.notes = m.notes || [];
  }

  // Known problems in the source documents, shown in the Library.
  const SOURCE_ISSUES = [
    'The 58-pattern manual says bullish candles are “often colored in (or black)” and bearish ones “empty (white)”. That is backwards: in the standard convention a hollow or white body closes up and a filled or black body closes down. This trainer uses green for up and red for down.',
    'The 58-pattern manual promises 58 patterns but its pages stop after entry #43, so later entries (Three White Soldiers, Rising and Falling Three Methods and others) are only listed by name.',
    'The Monster Guide’s Engulfing description says the second candle closes beyond the previous candle’s high (or low), while its recognition rule compares bodies only. This trainer uses the body rule, which both documents share.',
    'Several patterns in the 58-pattern manual depend on price gaps (Abandoned Baby, Kicking, Doji Stars, Island Reversal). Gaps are rare on 24-hour forex charts, so those patterns are left out.',
  ];

  // ---------- setup checklist (Monster Guide pp. 14 and 20) ----------
  // 1. trade with the bigger trend, 2. at a support/resistance level after a
  // pullback, 3. the reversal candle is larger than the candles before it.

  const SETUP_PATTERNS = ['hammer', 'bullish-engulfing', 'piercing-line', 'tweezer-bottom', 'morning-star',
    'shooting-star', 'bearish-engulfing', 'dark-cloud-cover', 'tweezer-top', 'evening-star'];
  const MIRROR_OF = { 'shooting-star': 'hammer', 'bearish-engulfing': 'bullish-engulfing', 'dark-cloud-cover': 'piercing-line', 'tweezer-top': 'tweezer-bottom', 'evening-star': 'morning-star' };
  const SETUP = { maPeriod: 20, maLookback: 10, maSlope: 1.0, levelTol: 0.6, maxPierce: 1.5, sizeRatio: 1.3, sizeLookback: 10 };

  const mirrorCandle = (k) => ({ o: -k.o, h: -k.l, l: -k.h, c: -k.c });

  function sma(cs, end, n = SETUP.maPeriod) {
    if (end - n + 1 < 0) return null;
    let t = 0;
    for (let j = end - n + 1; j <= end; j++) t += cs[j].c;
    return t / n;
  }

  // Direction of the 20-period moving average over the 10 candles before `start`.
  function bigTrend(cs, start) {
    const atr = avgRange(cs, start);
    const now = sma(cs, start - 1);
    const then = sma(cs, start - 1 - SETUP.maLookback);
    if (now === null || then === null) return { dir: 'flat', slope: 0 };
    const slope = (now - then) / atr;
    return { dir: slope >= SETUP.maSlope ? 'up' : slope <= -SETUP.maSlope ? 'down' : 'flat', slope };
  }

  function evaluateSetup(cs, i, id, level) {
    const def = BY_ID[id];
    const start = i - def.candles + 1;
    const atr = avgRange(cs, start);
    const bull = def.signal === 'bullish';
    const t = bigTrend(cs, start);
    let ext = bull ? Infinity : -Infinity;
    for (let j = start; j <= i; j++) ext = bull ? Math.min(ext, cs[j].l) : Math.max(ext, cs[j].h);
    // distance from the level, in average ranges, measured away from the level (positive = has not reached it)
    const dist = (bull ? ext - level : level - ext) / atr;
    const closedRightSide = bull ? cs[i].c >= level : cs[i].c <= level;
    const before = avgRange(cs, start, SETUP.sizeLookback);
    const ratio = (cs[i].h - cs[i].l) / before;
    const res = {
      trend: { ok: t.dir === (bull ? 'up' : 'down'), dir: t.dir, slope: t.slope },
      level: { ok: dist <= SETUP.levelTol && dist >= -SETUP.maxPierce && closedRightSide, dist, closedRightSide },
      size: { ok: ratio >= SETUP.sizeRatio, ratio },
      extreme: ext,
      atr,
    };
    res.pass = res.trend.ok && res.level.ok && res.size.ok;
    return res;
  }

  // Bullish construction in "u" units; bearish setups are mirrored.
  function setupRaw(rng, baseId, want) {
    const out = [];
    const push = (arr) => { out.push(...arr); return arr[arr.length - 1].c; };
    let last, level;
    if (want.trend) {
      // uptrend: old resistance (leg 1 high) becomes support on the pullback
      last = push(series(rng, 0, 8, 0));
      const leg1 = series(rng, last, 8, 0.5);
      level = Math.max(...leg1.map((k) => k.h));
      last = push(leg1);
      last = push(series(rng, last, 3, -0.35));
      last = push(series(rng, last, 11, 0.6));
    } else {
      // downtrend: price falls back to an old base low
      last = push(series(rng, 0, 8, 0));
      level = Math.min(...out.map((k) => k.l));
      last = push(series(rng, last, 12, 0.6));
    }
    // Build the pattern first (relative to 0) so the pullback can end where its extreme lands.
    const scale = want.size ? R(rng, 1.5, 1.9) : R(rng, 0.75, 0.95);
    const pat = BY_ID[baseId].build(rng, 0).map((k) => ({ o: k.o * scale, h: k.h * scale, l: k.l * scale, c: k.c * scale }));
    const extOff = Math.min(...pat.map((k) => k.l));
    const target = level - extOff + (want.level ? R(rng, -0.5, 0.3) : R(rng, 1.2, 2.2));
    let n = 0;
    while ((last > target || n < 6) && n < 18) { last = push(series(rng, last, 1, -0.5)); n++; }
    if (last > target + 0.4) return null;
    out.push(...pat.map((k) => ({ o: k.o + last, h: k.h + last, l: k.l + last, c: k.c + last })));
    return { candles: out, level };
  }

  // want = { trend, level, size } booleans: which checks the chart should pass.
  function generateSetup(id, rng, want) {
    const def = BY_ID[id];
    if (!SETUP_PATTERNS.includes(id)) throw new Error('Not a setup pattern: ' + id);
    const baseId = MIRROR_OF[id] || id;
    for (let attempt = 0; attempt < 1500; attempt++) {
      const raw = setupRaw(rng, baseId, want);
      if (!raw) continue;
      let { candles, level } = raw;
      if (MIRROR_OF[id]) { candles = candles.map(mirrorCandle); level = -level; }
      const m = toMarket(rng, candles, [level]);
      const i = m.candles.length - 1;
      if (!matches(m.candles, i, id)) continue;
      const ev = evaluateSetup(m.candles, i, id, m.extra[0]);
      if (ev.trend.ok !== want.trend || ev.level.ok !== want.level || ev.size.ok !== want.size) continue;
      return { pair: m.pair, tf: m.tf, candles: m.candles, id, index: i, start: i - def.candles + 1, level: m.extra[0], evaluation: ev, attempts: attempt + 1 };
    }
    throw new Error('Could not generate setup: ' + id + ' ' + JSON.stringify(want));
  }

  // ---------- reading a single candle (Monster Guide pp. 32-35) ----------
  // 1. body colour = who is in control, 2. wick length = rejection,
  // 3. body-to-wick ratio = the whole story.

  const READ_KINDS = [
    { id: 'buyers', label: 'Buyers in control', bias: 'bullish', why: 'A strong close near the high with a short upper wick: buyers held the gains.' },
    { id: 'sellers', label: 'Sellers in control', bias: 'bearish', why: 'A strong close near the low with a short lower wick: sellers held the losses.' },
    { id: 'reject-high', label: 'Higher prices rejected', bias: 'bearish', why: 'The long upper wick shows sellers pushed price back down. That outweighs the colour of a small body.' },
    { id: 'reject-low', label: 'Lower prices rejected', bias: 'bullish', why: 'The long lower wick shows buyers pushed price back up. That outweighs the colour of a small body.' },
    { id: 'indecision', label: 'Indecision', bias: 'neutral', why: 'A tiny body with similar wicks on both sides: neither side won the session.' },
  ];

  function classifyCandle(k) {
    const s = shape(k);
    const out = [];
    if (s.bull && s.body >= 0.6 * s.range && s.upper <= 0.15 * s.range) out.push('buyers');
    if (s.bear && s.body >= 0.6 * s.range && s.lower <= 0.15 * s.range) out.push('sellers');
    if (s.upper >= 0.55 * s.range) out.push('reject-high');
    if (s.lower >= 0.55 * s.range) out.push('reject-low');
    if (s.body <= 0.2 * s.range && s.upper >= 0.3 * s.range && s.lower >= 0.3 * s.range) out.push('indecision');
    return out;
  }

  function buildRead(rng, last, kind) {
    const o = last + R(rng, -0.03, 0.03);
    const dir = rng() < 0.6 ? 1 : -1; // small bodies lean against the wick more often: the trap the guide warns about
    switch (kind) {
      case 'buyers': return mk(o, o + R(rng, 0.9, 1.4), R(rng, 0, 0.12), R(rng, 0, 0.35));
      case 'sellers': return mk(o, o - R(rng, 0.9, 1.4), R(rng, 0, 0.35), R(rng, 0, 0.12));
      case 'reject-high': return mk(o, o + dir * R(rng, 0.1, 0.35), R(rng, 0.9, 1.4), R(rng, 0, 0.15));
      case 'reject-low': return mk(o, o - dir * R(rng, 0.1, 0.35), R(rng, 0, 0.15), R(rng, 0.9, 1.4));
      default: {
        const w = R(rng, 0.45, 0.7);
        return mk(o, o + R(rng, -0.12, 0.12), w * R(rng, 0.85, 1.15), w * R(rng, 0.85, 1.15));
      }
    }
  }

  function generateRead(rng, kind) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const ctx = series(rng, 0, 14, 0);
      const k = buildRead(rng, ctx[ctx.length - 1].c, kind);
      const m = toMarket(rng, ctx.concat([k]));
      const i = m.candles.length - 1;
      const got = classifyCandle(m.candles[i]);
      if (got.length === 1 && got[0] === kind) return { ...m, kind, index: i, start: i };
    }
    throw new Error('Could not generate candle: ' + kind);
  }

  return {
    PATTERNS,
    BY_ID,
    PAIRS,
    TIMEFRAMES,
    mulberry32,
    shape,
    avgRange,
    trendInto,
    matches,
    detectAt,
    generateDrill,
    generateSpot,
    explain,
    SOURCES,
    SOURCE_ISSUES,
    SETUP,
    SETUP_PATTERNS,
    sma,
    bigTrend,
    evaluateSetup,
    generateSetup,
    READ_KINDS,
    classifyCandle,
    generateRead,
    _internal: { series, mk, TREND_LOOKBACK, TREND_THRESHOLD },
  };
});
