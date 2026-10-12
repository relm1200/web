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
  const hammerShape = (s, a) =>
    isSmallBody(s) && s.lower >= 2 * s.body && s.lower >= 0.55 * s.range && s.upper <= 0.12 * s.range && s.range >= 0.7 * a;
  const invertedShape = (s, a) =>
    isSmallBody(s) && s.upper >= 2 * s.body && s.upper >= 0.55 * s.range && s.lower <= 0.12 * s.range && s.range >= 0.7 * a;
  const isLongBody = (s, a) => s.body >= 0.6 * s.range && s.body >= 0.8 * a;

  // ---------- builders (generate an idealised, randomised instance) ----------

  function buildHammerLike(rng, last, inverted) {
    const b = R(rng, 0.22, 0.38);
    const longWick = b * R(rng, 2.4, 3.4) + 0.15;
    const tiny = R(rng, 0, 0.05);
    const o = last + R(rng, -0.05, 0.05);
    const c = o + (rng() < 0.5 ? b : -b);
    return [inverted ? mk(o, c, longWick, tiny) : mk(o, c, tiny, longWick)];
  }

  function longCandle(rng, open, dir) {
    const b = R(rng, 1.3, 1.8);
    return mk(open, open + dir * b, R(rng, 0.05, 0.2), R(rng, 0.05, 0.2));
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
        'Small body near the top of the range (either colour)',
        'Lower wick at least 2× the body, little or no upper wick',
      ],
      meaning:
        'Sellers pushed price well lower, but buyers drove it back up near the open. Selling pressure is fading at the lows.',
      confirm: 'Wait for a close above the hammer’s high. A common stop goes just below the hammer’s low.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && hammerShape(shape(cs[i]), ctx.atr);
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
        'Small body near the top of the range',
        'Lower wick at least 2× the body, little or no upper wick',
      ],
      meaning:
        'Price sold off hard within the session before recovering. In an uptrend that dip shows sellers testing the market, an early warning the rally is tiring.',
      confirm: 'Needs a bearish close below the hanging man’s body on the next candle. Without it, the trend usually continues.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && hammerShape(shape(cs[i]), ctx.atr);
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
        'Small body near the bottom of the range',
        'Upper wick at least 2× the body, little or no lower wick',
      ],
      meaning:
        'Buyers attempted a push higher at the lows. They didn’t hold it, but it is the first sign of demand after a sell-off.',
      confirm: 'Weaker than a hammer. Wait for the next candle to close above the inverted hammer’s body.',
      test(cs, i, ctx) {
        return ctx.trend === 'down' && invertedShape(shape(cs[i]), ctx.atr);
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
        'Small body near the bottom of the range',
        'Upper wick at least 2× the body, little or no lower wick',
      ],
      meaning:
        'Buyers spiked price higher, then sellers slammed it back down to the open. Strong rejection of higher prices.',
      confirm: 'Look for the next candle to close below the shooting star’s body. Stops often go above the wick high.',
      test(cs, i, ctx) {
        return ctx.trend === 'up' && invertedShape(shape(cs[i]), ctx.atr);
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
      confuse: ['piercing-line', 'bullish-harami', 'tweezer-bottom'],
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
      confuse: ['dark-cloud-cover', 'bearish-harami', 'tweezer-top'],
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
      confuse: ['bullish-engulfing', 'bearish-harami', 'morning-star'],
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
      confuse: ['bearish-engulfing', 'bullish-harami', 'evening-star'],
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
        'Candle 1 is bearish, candle 2 is bullish',
        'Both candles make the same low (within 5% of an average range)',
      ],
      meaning: 'Price tested the same low twice and was rejected both times. That level is acting as support.',
      confirm: 'A close above candle 1’s open confirms it. A stop just under the shared low is common.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'down' && p.bear && s.bull && p.body >= 0.3 * ctx.atr && s.body >= 0.2 * ctx.atr &&
          Math.abs(cs[i - 1].l - cs[i].l) <= 0.05 * ctx.atr
        );
      },
      build(rng, last) {
        const p = mk(last, last - R(rng, 0.7, 1.0), R(rng, 0.03, 0.12), R(rng, 0.3, 0.5));
        const pb = p.o - p.c;
        const o = p.c - R(rng, 0.01, 0.05);
        const c = o + pb * R(rng, 0.35, 0.45);
        const s = { o, c, h: c + R(rng, 0.03, 0.15), l: p.l + R(rng, -0.02, 0.02) };
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
        'Candle 1 is bullish, candle 2 is bearish',
        'Both candles make the same high (within 5% of an average range)',
      ],
      meaning: 'Price tested the same high twice and was rejected both times. That level is acting as resistance.',
      confirm: 'A close below candle 1’s open confirms it. A stop just above the shared high is common.',
      test(cs, i, ctx) {
        const p = shape(cs[i - 1]);
        const s = shape(cs[i]);
        return (
          ctx.trend === 'up' && p.bull && s.bear && p.body >= 0.3 * ctx.atr && s.body >= 0.2 * ctx.atr &&
          Math.abs(cs[i - 1].h - cs[i].h) <= 0.05 * ctx.atr
        );
      },
      build(rng, last) {
        const p = mk(last, last + R(rng, 0.7, 1.0), R(rng, 0.3, 0.5), R(rng, 0.03, 0.12));
        const pb = p.c - p.o;
        const o = p.c + R(rng, 0.01, 0.05);
        const c = o - pb * R(rng, 0.35, 0.45);
        const s = { o, c, h: p.h + R(rng, -0.02, 0.02), l: c - R(rng, 0.03, 0.15) };
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
        'Candle 2 has a small body at or below candle 1’s close',
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
          ctx.trend === 'down' && q.bear && isLongBody(q, ctx.atr) && p.body <= 0.3 * q.body &&
          p.bodyTop <= a.c + 0.1 * q.body && s.bull && cs[i].c >= a.c + 0.5 * q.body
        );
      },
      build(rng, last) {
        const q = longCandle(rng, last, -1);
        const qb = q.o - q.c;
        const po = q.c - R(rng, 0.05, 0.15);
        const pc = po + R(rng, -0.12, 0.12);
        const p = mk(po, pc, R(rng, 0.1, 0.3), R(rng, 0.1, 0.3));
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
        'Candle 2 has a small body at or above candle 1’s close',
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
          ctx.trend === 'up' && q.bull && isLongBody(q, ctx.atr) && p.body <= 0.3 * q.body &&
          p.bodyBot >= a.c - 0.1 * q.body && s.bear && cs[i].c <= a.c - 0.5 * q.body
        );
      },
      build(rng, last) {
        const q = longCandle(rng, last, 1);
        const qb = q.c - q.o;
        const po = q.c + R(rng, 0.05, 0.15);
        const pc = po + R(rng, -0.12, 0.12);
        const p = mk(po, pc, R(rng, 0.1, 0.3), R(rng, 0.1, 0.3));
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

  function toMarket(rng, raw) {
    const pair = pick(rng, PAIRS);
    const tf = pick(rng, TIMEFRAMES);
    const scale = tf.atrPips * pair.pip;
    const base = pair.base * (1 + R(rng, -0.015, 0.015));
    const f = 10 ** pair.dp;
    const round = (x) => Math.round((base + x * scale) * f) / f;
    const candles = raw.map((k) => ({ o: round(k.o), h: round(k.h), l: round(k.l), c: round(k.c) }));
    return { pair, tf, candles };
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
    _internal: { series, mk, TREND_LOOKBACK, TREND_THRESHOLD },
  };
});
