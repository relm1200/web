// Checks that the TradingView indicator's rules match the trainer's detector.
// The Pine source is translated to JavaScript (a small subset: expressions, one-line and
// block functions, for/if/:=), then evaluated bar by bar on generated charts and compared
// with js/patterns.js. This catches offset, threshold and logic slips in the port; it does
// not check Pine syntax, which only TradingView's compiler can do.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../js/patterns.js');
const S = require('../js/structure.js');

const PINE = fs.readFileSync(path.join(__dirname, '..', 'tradingview', 'wick-reader-patterns.pine'), 'utf8');

// Pine variable name -> trainer pattern id
const MAP = {
  p_doji: 'doji', p_stop: 'spinning-top', p_dfly: 'dragonfly-doji', p_grav: 'gravestone-doji', p_ham: 'hammer',
  p_hang: 'hanging-man', p_invh: 'inverted-hammer', p_sstar: 'shooting-star', p_bmaru: 'bullish-marubozu',
  p_smaru: 'bearish-marubozu', p_buEng: 'bullish-engulfing', p_beEng: 'bearish-engulfing', p_buHar: 'bullish-harami',
  p_beHar: 'bearish-harami', p_pierce: 'piercing-line', p_dcc: 'dark-cloud-cover', p_twB: 'tweezer-bottom',
  p_twT: 'tweezer-top', p_mstar: 'morning-star', p_estar: 'evening-star', p_tws: 'three-white-soldiers',
  p_tbc: 'three-black-crows', p_tiu: 'three-inside-up', p_tid: 'three-inside-down', p_tou: 'three-outside-up',
  p_tod: 'three-outside-down', p_r3m: 'rising-three-methods', p_f3m: 'falling-three-methods',
};

function expr(e) {
  return e
    .replace(/\bavgRange\[([^\]]+)\]/g, 'avgRange($1)')
    .replace(/\b(high|low|open|close)\[([^\]]+)\]/g, 'bar.$1($2)')
    .replace(/(?<![.\w])(high|low|open|close)\b(?!\()/g, 'bar.$1(0)')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\s+/g, '!')
    .replace(/\bmath\.(abs|max|min)\b/g, 'Math.$1');
}

// Translate the pattern section of the Pine file (helpers through the 5-candle rules).
function translate(src) {
  const start = src.indexOf('// ───────────── candle helpers');
  const end = src.indexOf('// ───────────── marking');
  const lines = src.slice(start, end).split('\n');
  const out = [];
  const stack = []; // indentation levels of open JS blocks
  const indentOf = (l) => l.match(/^ */)[0].length;
  const close = (ind) => { while (stack.length && stack[stack.length - 1] >= ind) { stack.pop(); out.push('}'); } };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!raw.trim() || raw.trim().startsWith('//')) continue;
    const ind = indentOf(raw);
    close(ind);
    const line = raw.trim();
    if (line.startsWith('avgRange = ta.sma(')) continue; // supplied by the harness (same formula)
    let m;
    if ((m = line.match(/^(\w+)\(([^)]*)\)\s*=>\s*(.*)$/))) {
      const params = m[2].split(',').map((p) => p.trim().split(/\s+/).pop()).filter(Boolean).join(', ');
      if (m[3]) { out.push(`function ${m[1]}(${params}) { return ${expr(m[3])}; }`); continue; }
      // block function: the last line of the body is the return value
      const body = [];
      let k = n + 1;
      while (k < lines.length && (lines[k].trim() === '' || indentOf(lines[k]) > ind)) body.push(lines[k++]);
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const last = body.pop();
      const inner = translate('// ───────────── candle helpers\n' + body.map((b) => b.slice(4)).join('\n') + '\n// ───────────── marking');
      out.push(`function ${m[1]}(${params}) {\n${inner}\nreturn ${expr(last.trim())};\n}`);
      n = k - 1;
      continue;
    }
    if ((m = line.match(/^for (\w+) = (.+) to (.+)$/))) { out.push(`for (let ${m[1]} = ${expr(m[2])}; ${m[1]} <= ${expr(m[3])}; ${m[1]}++) {`); stack.push(ind); continue; }
    if ((m = line.match(/^if (.+)$/))) { out.push(`if (${expr(m[1])}) {`); stack.push(ind); continue; }
    if ((m = line.match(/^(\w+)\s+:=\s+(.+)$/))) { out.push(`${m[1]} = ${expr(m[2])};`); continue; }
    if ((m = line.match(/^(\w+)\s+=\s+(.+)$/))) { out.push(`let ${m[1]} = ${expr(m[2])};`); continue; }
    throw new Error('Untranslated Pine line: ' + line);
  }
  close(0);
  return out.join('\n');
}

const JS = translate(PINE);
const names = Object.keys(MAP);
// eslint-disable-next-line no-new-func
const evaluate = new Function('bar', 'avgRange', 'i_atrLen', 'i_trendLen', 'i_trendThr',
  `${JS}\nreturn { ${names.join(', ')} };`);

function pineAt(cs, i) {
  const bar = {
    high: (k) => cs[i - k].h, low: (k) => cs[i - k].l, open: (k) => cs[i - k].o, close: (k) => cs[i - k].c,
  };
  // Pine: ta.sma(high - low, 10)[k] = mean range of bars k .. k+9 back
  const avgRange = (k) => { let t = 0; for (let j = 0; j < 10; j++) t += cs[i - k - j].h - cs[i - k - j].l; return t / 10; };
  const out = evaluate(bar, avgRange, 10, 6, 1.5);
  return names.filter((nm) => out[nm]).map((nm) => MAP[nm]).sort();
}

test('the Pine pattern section translates completely', () => {
  for (const nm of names) assert.ok(new RegExp(`^${nm}\\s+= `, 'm').test(PINE), `${nm} missing from Pine`);
  assert.equal(names.length, L.PATTERNS.length);
});

test('Pine rules flag the same patterns on the same bars as the trainer', () => {
  const rng = L.mulberry32(2026);
  const charts = [];
  for (const p of L.PATTERNS) {
    for (let n = 0; n < 25; n++) {
      charts.push(L.generateDrill(p.id, rng, { length: 40 }).candles);
      if (p.spot !== false) charts.push(L.generateSpot(p.id, rng).candles);
    }
  }
  for (let n = 0; n < 100; n++) charts.push(L._internal.series(rng, 0, 120, 0));
  // real market data (OANDA:EURUSD 4h from TradingView)
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tradingview', 'reference', 'OANDA_EURUSD_4h.json'), 'utf8'));
  charts.push(real.c.map((c, i) => ({ o: real.o[i], h: real.h[i], l: real.l[i], c })));
  let bars = 0, hits = 0;
  for (const cs of charts) {
    // the Pine avg range needs 10 candles before a 5-candle pattern plus the trend window
    for (let i = 21; i < cs.length; i++) {
      const want = L.detectAt(cs, i).slice().sort();
      const got = pineAt(cs, i);
      assert.deepEqual(got, want, `bar ${i}`);
      bars++;
      hits += want.length;
    }
  }
  assert.ok(hits > 1000, `only ${hits} pattern hits compared over ${bars} bars`);
});

// Mirror of the Pine market-structure block (streaming), compared with js/structure.js (batch).
function pineStructure(cs, n = 2) {
  let lastKind = 0, hiCur = null, hiRef = null, loCur = null, loRef = null;
  const tags = new Map(); // key: bar index + 'h' or 'l' (an outside bar can be both)
  let hiIdx = null, loIdx = null;
  for (let i = 2 * n; i < cs.length; i++) {
    const c = i - n;
    let isH = true, isL = true;
    for (let j = i - 2 * n; j <= i; j++) {
      if (j === c) continue;
      if (cs[j].h >= cs[c].h) isH = false;
      if (cs[j].l <= cs[c].l) isL = false;
    }
    if (isH) {
      const p = cs[c].h;
      const replace = lastKind === 1 && p > hiCur;
      if (lastKind !== 1 || replace) {
        if (replace) tags.delete(hiIdx + 'h'); else hiRef = hiCur;
        hiCur = p; hiIdx = c; lastKind = 1;
        tags.set(c + 'h', hiRef === null ? null : p > hiRef ? 'HH' : 'LH');
      }
    }
    if (isL) {
      const p = cs[c].l;
      const replace = lastKind === -1 && p < loCur;
      if (lastKind !== -1 || replace) {
        if (replace) tags.delete(loIdx + 'l'); else loRef = loCur;
        loCur = p; loIdx = c; lastKind = -1;
        tags.set(c + 'l', loRef === null ? null : p > loRef ? 'HL' : 'LL');
      }
    }
  }
  return tags;
}

test('Pine market-structure labels match the trainer', () => {
  const rng = L.mulberry32(404);
  for (let n = 0; n < 300; n++) {
    const g = n % 2 ? S.generateStructure(rng) : { candles: L._internal.series(rng, 0, 80, 0) };
    const want = S.analyse(g.candles).swings;
    const got = pineStructure(g.candles);
    const key = (s) => s.index + s.kind[0];
    assert.deepEqual([...got.keys()].sort(), want.map(key).sort());
    for (const s of want) assert.equal(got.get(key(s)), s.label);
  }
});
