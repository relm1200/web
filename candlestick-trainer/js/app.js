/* Wick Reader UI: drill, spot, setups, library and progress views. */
(function () {
  'use strict';
  const L = window.CandleLab;
  const { PATTERNS, BY_ID } = L;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const rng = L.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BIAS_LABEL = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Indecision' };
  const TREND_LABEL = { down: 'after a decline', up: 'after a rally', null: 'in any trend' };
  const ROLE_LABEL = { reversal: 'Reversal', continuation: 'Continuation', indecision: 'Indecision' };
  const GROUPS = ['single', 'double', 'triple', 'multi'];

  // ---------- persistence (per-viewer convenience only) ----------
  const KEY = 'wick-reader.v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  const saved = load();
  const stats = saved.stats || {};
  const allGroups = () => ({ single: true, double: true, triple: true, multi: true });
  const sp = saved.prefs || {};
  const prefs = Object.assign({ mode: 'name', highlight: true, adaptive: true, tab: 'drill', best: 0 }, sp, {
    groups: Object.assign(allGroups(), sp.groups),
    spotGroups: Object.assign(allGroups(), sp.spotGroups),
  });
  // Counters for the modes that are not tied to one pattern.
  const extra = Object.assign({ read: { a: 0, c: 0 }, setup: { a: 0, c: 0 } }, saved.extra);
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ stats, prefs, extra })); } catch (e) { /* storage unavailable */ }
  }
  function stat(id) {
    return (stats[id] = stats[id] || { a: 0, c: 0, sa: 0, sc: 0, mix: {} });
  }

  // ---------- chart rendering ----------
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Candle open times, skipping the FX weekend, ending in the most recent full week.
  function candleTimes(n, minutes) {
    const out = [];
    let t = Date.UTC(2026, 9, 9, 21 - (minutes >= 1440 ? 21 : minutes / 60), 0);
    while (out.length < n) {
      const d = new Date(t);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) out.unshift(d);
      t -= minutes * 60000;
    }
    return out;
  }
  function timeLabel(d, minutes) {
    if (minutes >= 1440) return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    return DAYS[d.getUTCDay()] + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':00';
  }

  function renderChart(svg, chart, opts = {}) {
    const cs = chart.candles;
    const compact = !!opts.compact;
    const measured = Math.round(svg.getBoundingClientRect().width);
    const W = opts.width || (measured ? Math.max(300, measured) : 760);
    const H = opts.height || (W < 600 ? 320 : 360);
    if (!compact) svg._render = [chart, opts];
    const pad = compact ? { l: 8, r: 8, t: 10, b: 10 } : { l: 8, r: 72, t: 14, b: 26 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    let lo = Infinity, hi = -Infinity;
    for (const k of cs) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); }
    for (const p of [opts.level && opts.level.price, ...(opts.lines || []).map((l) => l.price)]) {
      if (typeof p === 'number') { lo = Math.min(lo, p); hi = Math.max(hi, p); }
    }
    const span = hi - lo || 1;
    lo -= span * 0.06; hi += span * 0.06;
    const y = (p) => pad.t + ((hi - p) / (hi - lo)) * ph;
    const slot = pw / cs.length;
    const x = (i) => pad.l + slot * (i + 0.5);
    const bw = Math.max(2, slot * 0.62);
    const dp = chart.pair ? chart.pair.dp : 5;

    // shading for the pattern
    if (opts.shade) {
      const [s, e] = opts.shade;
      el('rect', { class: 'shade', x: pad.l + slot * s, y: pad.t, width: slot * (e - s + 1), height: ph, rx: 3 }, svg);
    }

    if (!compact) {
      const step = niceStep((hi - lo) / 5);
      const tagY = y(cs[cs.length - 1].c);
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const yy = y(v);
        el('line', { class: 'gridline', x1: pad.l, x2: pad.l + pw, y1: yy, y2: yy }, svg);
        if (opts.lastTag !== false && Math.abs(yy - tagY) < 16) continue; // keep clear of the price tag
        const t = el('text', { x: W - pad.r + 6, y: yy + 4 }, svg);
        t.textContent = v.toFixed(dp);
      }
      const times = candleTimes(cs.length, chart.tf.minutes);
      const every = Math.max(1, Math.round(cs.length / Math.max(2, Math.floor(pw / 110))));
      for (let i = cs.length - 1; i >= 0; i -= every) {
        const t = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, svg);
        t.textContent = timeLabel(times[i], chart.tf.minutes);
      }
    }

    if (opts.level) {
      const { price, band, label } = opts.level;
      if (band) el('rect', { class: 'level-zone', x: pad.l, width: pw, y: y(price + band), height: Math.max(1, y(price - band) - y(price + band)) }, svg);
      el('line', { class: 'level', x1: pad.l, x2: pad.l + pw, y1: y(price), y2: y(price) }, svg);
      const t = el('text', { class: 'level-text', x: pad.l + 4, y: y(price) - 5 }, svg);
      t.textContent = label;
    }
    if (opts.ma) {
      const pts = [];
      cs.forEach((_, i) => { const v = L.sma(cs, i); if (v !== null) pts.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
      if (pts.length > 1) el('polyline', { class: 'ma', points: pts.join(' ') }, svg);
    }

    const hover = el('rect', { class: 'hover-col', x: 0, y: pad.t, width: slot, height: ph, visibility: 'hidden' }, svg);
    const marks = el('g', {}, svg);
    for (const m of opts.marks || []) {
      const [s, e] = m.range;
      el('rect', { class: m.cls, x: pad.l + slot * s + 1, y: pad.t + 1, width: slot * (e - s + 1) - 2, height: ph - 2, rx: 4 }, marks);
    }

    cs.forEach((k, i) => {
      const cls = k.c >= k.o ? 'bull' : 'bear';
      el('line', { class: cls, x1: x(i), x2: x(i), y1: y(k.h), y2: y(k.l), 'stroke-width': compact ? 1.5 : 1.2 }, svg);
      const top = y(Math.max(k.o, k.c));
      const h = Math.max(1, Math.abs(y(k.o) - y(k.c)));
      el('rect', { class: cls, x: x(i) - bw / 2, y: top, width: bw, height: h, 'stroke-width': 0 }, svg);
    });

    for (const ln of opts.lines || []) {
      el('line', { class: ln.cls, x1: x(cs.length - 1) - slot * 6, x2: pad.l + pw, y1: y(ln.price), y2: y(ln.price) }, svg);
      const t = el('text', { class: 'line-text', x: x(cs.length - 1) - slot * 6, y: y(ln.price) + (ln.below ? 13 : -4) }, svg);
      t.textContent = ln.label;
    }

    if (!compact && opts.lastTag !== false) {
      const last = cs[cs.length - 1].c;
      const yy = y(last);
      el('line', { class: 'last-line', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }, svg);
      el('rect', { class: 'last-tag', x: W - pad.r + 2, y: yy - 9, width: pad.r - 4, height: 18, rx: 3 }, svg);
      const t = el('text', { class: 'last-tag-text', x: W - pad.r + 6, y: yy + 4 }, svg);
      t.textContent = last.toFixed(dp);
    }

    if (compact) return;

    // hover / pick interaction
    const ohlcEl = opts.ohlcEl;
    let cur = -1;
    const show = (i) => {
      cur = i;
      if (i < 0) { hover.setAttribute('visibility', 'hidden'); if (ohlcEl) ohlcEl.textContent = 'Hover a candle for O H L C'; return; }
      hover.setAttribute('x', pad.l + slot * i);
      hover.setAttribute('visibility', 'visible');
      const k = cs[i];
      const pips = Math.round((k.h - k.l) / chart.pair.pip);
      if (ohlcEl) ohlcEl.textContent = `O ${k.o.toFixed(dp)}  H ${k.h.toFixed(dp)}  L ${k.l.toFixed(dp)}  C ${k.c.toFixed(dp)}  ${pips}p`;
    };
    const idxFrom = (ev) => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const m = svg.getScreenCTM();
      if (!m) return -1;
      const p = pt.matrixTransform(m.inverse());
      const i = Math.floor((p.x - pad.l) / slot);
      return i >= 0 && i < cs.length ? i : -1;
    };
    svg.onpointermove = (ev) => show(idxFrom(ev));
    svg.onpointerleave = () => show(-1);
    if (opts.onPick) {
      svg.setAttribute('tabindex', '0');
      svg.onclick = (ev) => { const i = idxFrom(ev); if (i >= 0) opts.onPick(i); };
      svg.onkeydown = (ev) => {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          const d = ev.key === 'ArrowLeft' ? -1 : 1;
          show(Math.min(cs.length - 1, Math.max(0, (cur < 0 ? cs.length : cur) + d)));
        } else if ((ev.key === 'Enter' || ev.key === ' ') && cur >= 0) {
          ev.preventDefault();
          opts.onPick(cur);
        }
      };
    } else {
      svg.removeAttribute('tabindex');
      svg.onclick = null;
      svg.onkeydown = null;
    }
  }

  // ---------- shared helpers ----------
  const biasChip = (sig) => `<span class="bias ${sig}">${BIAS_LABEL[sig]}</span>`;

  function measureHtml(chart, index, id) {
    const ex = L.explain(chart.candles, index, id);
    const move = (ex.move > 0 ? '+' : ex.move < 0 ? '−' : '') + Math.abs(ex.move).toFixed(1);
    const trendWord = ex.trend === 'down' ? 'falling' : ex.trend === 'up' ? 'rising' : 'no clear trend';
    const rows = [`Trend into it: ${trendWord} (${move} avg ranges over 6 candles)`];
    ex.candles.forEach((c, n) => {
      const label = ex.candles.length > 1 ? `Candle ${n + 1}` : 'Candle';
      rows.push(`${label}: ${c.colour}, body ${c.bodyPct}%, upper wick ${c.upperPct}%, lower wick ${c.lowerPct}%, size ${c.rangeAtr}× avg`);
    });
    return `<ul class="measure">${rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
  }

  function citeHtml(def) {
    const refs = def.refs.map((r) => {
      const src = L.SOURCES[r.src];
      return `<b>${esc(src.short)}</b> ${src.loc === 'page' ? 'p. ' : '#'}${r.n}`;
    });
    return `<p class="cite">Source: ${refs.length ? refs.join(' · ') : 'standard definition'}</p>`;
  }
  function notesHtml(def) {
    return def.notes.length ? `<div class="src-notes">${def.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : '';
  }

  function lessonHtml(def) {
    return `
      <p class="label">How to recognise it</p>
      <ul>${def.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="label">What it suggests</p>
      <p>${esc(def.meaning)}</p>
      <p class="label">Before acting</p>
      <p>${esc(def.confirm)}</p>
      ${notesHtml(def)}${citeHtml(def)}`;
  }

  function weightedPick(pool, kind) {
    if (pool.length === 1) return pool[0];
    const last = kind === 'spot' ? spot.lastId : drill.lastId;
    const cands = pool.filter((p) => p.id !== last);
    if (!prefs.adaptive) return cands[Math.floor(rng() * cands.length)];
    const w = cands.map((p) => {
      const s = stat(p.id);
      const a = kind === 'spot' ? s.sa : s.a;
      const c = kind === 'spot' ? s.sc : s.c;
      return 1 - (c + 1) / (a + 2) + 0.15; // Laplace-smoothed error rate plus a floor
    });
    let r = rng() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  // ---------- drill ----------
  const drill = { q: null, answered: false, score: 0, total: 0, streak: 0, focus: null, lastId: null };

  function drillPool() {
    if (drill.focus) return [BY_ID[drill.focus]];
    const pool = PATTERNS.filter((p) => prefs.groups[p.group]);
    return pool.length ? pool : PATTERNS;
  }

  function buildOptions(q) {
    if (prefs.mode === 'bias') {
      return ['bullish', 'bearish', 'neutral'].map((b) => ({ value: b, label: BIAS_LABEL[b] }));
    }
    const def = BY_ID[q.id];
    const taken = new Set(q.matches);
    const chosen = [def.id];
    const add = (id) => { if (!taken.has(id) && !chosen.includes(id) && chosen.length < 4) chosen.push(id); };
    shuffle(def.confuse.slice()).slice(0, 2).forEach(add);
    shuffle(drillPool().map((p) => p.id)).forEach(add);
    shuffle(PATTERNS.map((p) => p.id)).forEach(add);
    return shuffle(chosen).map((id) => ({ value: id, label: BY_ID[id].name }));
  }

  function newDrill() {
    const reading = prefs.mode === 'read';
    if (reading) {
      const kinds = L.READ_KINDS.filter((k) => k.id !== drill.lastKind);
      const kind = kinds[Math.floor(rng() * kinds.length)];
      drill.lastKind = kind.id;
      drill.q = L.generateRead(rng, kind.id);
      drill.q.options = L.READ_KINDS.map((k) => ({ value: k.id, label: k.label }));
    } else {
      const target = weightedPick(drillPool(), 'drill');
      drill.lastId = target.id;
      drill.q = L.generateDrill(target.id, rng);
      drill.q.options = buildOptions(drill.q);
    }
    drill.answered = false;
    $('drill-groups').hidden = reading;
    $('drill-focus').hidden = reading || !drill.focus;
    const n = drill.q.options.length;
    $('drill-prompt').textContent = reading ? 'What is the last candle telling you?' : prefs.mode === 'bias' ? 'Which way does this pattern lean?' : 'Which pattern just formed?';
    $('drill-hint').textContent = (reading ? 'Judge the body and both wicks together.' : 'The pattern ends on the last candle.') + ` Keys 1–${n} answer, Enter moves on.`;
    $('drill-feedback').hidden = true;
    $('drill-next').hidden = true;
    drawDrill();
    const box = $('drill-options');
    box.innerHTML = '';
    drill.q.options.forEach((o, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.value = o.value;
      b.innerHTML = `<span class="key">${n + 1}</span><span>${esc(o.label)}</span>`;
      b.addEventListener('click', () => answerDrill(o.value));
      box.appendChild(b);
    });
  }

  function drawDrill(reveal) {
    const q = drill.q;
    $('drill-instrument').textContent = `${q.pair.symbol} · ${q.tf.tf}`;
    renderChart($('drill-chart'), q, {
      shade: prefs.highlight || reveal ? [q.start, q.index] : null,
      ohlcEl: $('drill-ohlc'),
    });
  }

  function answerRead(value) {
    const q = drill.q;
    const kind = L.READ_KINDS.find((k) => k.id === q.kind);
    const ok = value === q.kind;
    extra.read.a++;
    if (ok) extra.read.c++;
    drill.total++;
    if (ok) { drill.score++; drill.streak++; } else drill.streak = 0;
    prefs.best = Math.max(prefs.best, drill.streak);
    persist();
    for (const b of $('drill-options').children) {
      b.disabled = true;
      if (b.dataset.value === q.kind) b.classList.add('correct');
      else if (b.dataset.value === value) b.classList.add('wrong');
      else b.classList.add('dim');
    }
    const sh = L.shape(q.candles[q.index]);
    const pct = (v) => Math.round((100 * v) / sh.range);
    const colour = sh.bull ? 'bullish' : sh.bear ? 'bearish' : 'flat';
    const fb = $('drill-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = `<p class="verdict">${ok ? 'Correct.' : 'Not this time.'}</p>
      <h3>${esc(kind.label)} ${biasChip(kind.bias)}</h3>
      <p>${esc(kind.why)}</p>
      <p class="label">What the candle shows</p>
      <ul class="measure"><li>${colour} close, body ${pct(sh.body)}%, upper wick ${pct(sh.upper)}%, lower wick ${pct(sh.lower)}% of the range</li></ul>
      <p class="label">Reading any candle</p>
      <ul>
        <li>The colour of the body tells you who won the session.</li>
        <li>A long wick shows rejection: buyers or sellers pushed price back.</li>
        <li>Weigh the body against the wicks. A long upper wick over a small bullish body is still a bearish story.</li>
      </ul>
      <p class="cite">Source: <b>Monster Guide</b> pp. 32–35. Thresholds: “in control” needs a body ≥ 60% of the range; “rejected” needs a wick ≥ 55%; “indecision” needs a body ≤ 20% with both wicks ≥ 30%.</p>`;
    fb.hidden = false;
    $('drill-next').hidden = false;
    $('drill-next').focus({ preventScroll: true });
    updateScores();
  }

  function answerDrill(value) {
    if (drill.answered) return;
    drill.answered = true;
    if (prefs.mode === 'read') { drawDrill(true); answerRead(value); return; }
    const q = drill.q;
    const def = BY_ID[q.id];
    const s = stat(q.id);
    let ok;
    if (prefs.mode === 'bias') ok = q.matches.some((id) => BY_ID[id].signal === value);
    else ok = q.matches.includes(value);
    s.a++;
    if (ok) s.c++;
    else if (prefs.mode === 'name') s.mix[value] = (s.mix[value] || 0) + 1;
    drill.total++;
    if (ok) { drill.score++; drill.streak++; } else drill.streak = 0;
    prefs.best = Math.max(prefs.best, drill.streak);
    persist();

    for (const b of $('drill-options').children) {
      b.disabled = true;
      const v = b.dataset.value;
      const right = prefs.mode === 'bias' ? v === def.signal : v === def.id;
      if (right) b.classList.add('correct');
      else if (v === value) b.classList.add('wrong');
      else b.classList.add('dim');
    }
    drawDrill(true);

    const others = q.matches.filter((id) => id !== q.id);
    let html = `<p class="verdict">${ok ? 'Correct.' : 'Not this time.'}</p>
      <h3>${esc(def.name)} ${biasChip(def.signal)}</h3>`;
    if (others.length) html += `<p>This chart also qualifies as ${others.map((id) => '<b>' + esc(BY_ID[id].name) + '</b>').join(' and ')}.</p>`;
    html += `<p class="label">What the chart shows</p>${measureHtml(q, q.index, q.id)}${lessonHtml(def)}`;
    if (!ok && prefs.mode === 'name' && BY_ID[value]) {
      const w = BY_ID[value];
      html += `<p class="label">Why not ${esc(w.name)}</p><ul>${w.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
    }
    const fb = $('drill-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = html;
    fb.hidden = false;
    $('drill-next').hidden = false;
    $('drill-next').focus({ preventScroll: true });
    updateScores();
  }

  function setFocus(id) {
    drill.focus = id;
    $('drill-focus').hidden = !id;
    if (id) $('drill-focus-name').textContent = BY_ID[id].name;
  }

  // ---------- spot ----------
  const spot = { q: null, done: false, score: 0, total: 0, streak: 0, lastId: null };

  function spotPool() {
    const pool = PATTERNS.filter((p) => p.spot !== false && prefs.spotGroups[p.group]);
    return pool.length ? pool : PATTERNS.filter((p) => p.spot !== false);
  }

  function newSpot() {
    const target = weightedPick(spotPool(), 'spot');
    spot.lastId = target.id;
    spot.q = L.generateSpot(target.id, rng);
    spot.done = false;
    $('spot-target').textContent = target.name;
    $('spot-instrument').textContent = `${spot.q.pair.symbol} · ${spot.q.tf.tf}`;
    $('spot-feedback').hidden = true;
    $('spot-next').hidden = true;
    $('spot-reveal').hidden = false;
    renderChart($('spot-chart'), spot.q, { ohlcEl: $('spot-ohlc'), onPick: pickSpot, lastTag: true });
  }

  function pickSpot(i, gaveUp) {
    if (spot.done) return;
    spot.done = true;
    const q = spot.q;
    const def = BY_ID[q.id];
    const ok = !gaveUp && L.matches(q.candles, i, q.id);
    const s = stat(q.id);
    s.sa++;
    if (ok) s.sc++;
    spot.total++;
    if (ok) { spot.score++; spot.streak++; } else spot.streak = 0;
    persist();

    const marks = [{ range: [q.start, q.index], cls: 'mark-ok' }];
    if (!ok && !gaveUp) marks.push({ range: [i, i], cls: 'mark-bad' });
    renderChart($('spot-chart'), q, { ohlcEl: $('spot-ohlc'), marks });

    let html;
    if (ok) html = `<p class="verdict">Found it.</p>`;
    else if (gaveUp) html = `<p class="verdict">Here it is, outlined in green.</p>`;
    else {
      const other = L.detectAt(q.candles, i).map((id) => BY_ID[id].name);
      html = `<p class="verdict">Not that candle. The ${esc(def.name)} is outlined in green.</p>`;
      if (other.length) html += `<p>The candle you picked completes ${other.map((n) => '<b>' + esc(n) + '</b>').join(' and ')} instead.</p>`;
    }
    html += `<h3>${esc(def.name)} ${biasChip(def.signal)}</h3><p class="label">What the chart shows</p>${measureHtml(q, q.index, q.id)}${lessonHtml(def)}`;
    const fb = $('spot-feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.innerHTML = html;
    fb.hidden = false;
    $('spot-reveal').hidden = true;
    $('spot-next').hidden = false;
    $('spot-next').focus({ preventScroll: true });
    updateScores();
  }

  // ---------- setups (Monster Guide checklist) ----------
  const setup = { q: null, answers: {}, done: false, score: 0, total: 0, streak: 0 };
  const CHECKS = ['trend', 'level', 'size'];

  function newSetup() {
    const ids = L.SETUP_PATTERNS.filter((id) => id !== (setup.q && setup.q.id));
    const id = ids[Math.floor(rng() * ids.length)];
    let want;
    if (rng() < 0.4) want = { trend: true, level: true, size: true };
    else {
      do want = { trend: rng() < 0.5, level: rng() < 0.5, size: rng() < 0.5 };
      while (want.trend && want.level && want.size);
    }
    setup.q = L.generateSetup(id, rng, want);
    setup.answers = {};
    setup.done = false;
    const def = BY_ID[id];
    const bull = def.signal === 'bullish';
    $('setup-target').textContent = def.name;
    $('setup-instrument').textContent = `${setup.q.pair.symbol} · ${setup.q.tf.tf}`;
    $('setup-level-name').textContent = bull ? 'Support' : 'Resistance';
    $('setup-desc-trend').textContent = bull ? 'The 20-period average is rising (slope ≥ +1.0 average ranges over 10 candles).' : 'The 20-period average is falling (slope ≤ −1.0 average ranges over 10 candles).';
    $('setup-desc-level').textContent = bull
      ? 'The pattern’s low reaches the shaded support zone (or dips up to 1.5 average ranges through it) and the pattern closes back above support.'
      : 'The pattern’s high reaches the shaded resistance zone (or pokes up to 1.5 average ranges through it) and the pattern closes back below resistance.';
    for (const row of $('setup-checks').children) {
      row.classList.remove('right', 'wrong');
      for (const b of row.querySelectorAll('button')) { b.setAttribute('aria-pressed', 'false'); b.disabled = false; }
    }
    $('setup-check').disabled = true;
    $('setup-check').hidden = false;
    $('setup-feedback').hidden = true;
    $('setup-next').hidden = true;
    drawSetup();
  }

  function drawSetup(lines) {
    const q = setup.q;
    const bull = BY_ID[q.id].signal === 'bullish';
    renderChart($('setup-chart'), q, {
      shade: [q.start, q.index],
      ma: true,
      level: { price: q.level, band: L.SETUP.levelTol * q.evaluation.atr, label: bull ? 'Support' : 'Resistance' },
      lines,
      ohlcEl: $('setup-ohlc'),
    });
  }

  function checkSetup() {
    if (setup.done || CHECKS.some((c) => !setup.answers[c])) return;
    setup.done = true;
    const q = setup.q;
    const def = BY_ID[q.id];
    const ev = q.evaluation;
    const bull = def.signal === 'bullish';
    let right = 0;
    for (const row of $('setup-checks').children) {
      const c = row.dataset.check;
      const ok = (setup.answers[c] === 'yes') === ev[c].ok;
      if (ok) right++;
      row.classList.add(ok ? 'right' : 'wrong');
      for (const b of row.querySelectorAll('button')) b.disabled = true;
    }
    const allRight = right === 3;
    extra.setup.a++;
    if (allRight) extra.setup.c++;
    setup.total++;
    if (allRight) { setup.score++; setup.streak++; } else setup.streak = 0;
    persist();

    const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
    const mark = (ok) => (ok ? '<span class="ok-mark">Pass</span>' : '<span class="bad-mark">Fail</span>');
    const levelWord = bull ? 'support' : 'resistance';
    const extWord = bull ? 'low' : 'high';
    const d = ev.level.dist;
    const where = d > 0 ? `${d.toFixed(1)} average ranges short of ${levelWord}` : `${Math.abs(d).toFixed(1)} average ranges through ${levelWord}`;
    const closeWord = ev.level.closedRightSide ? `closed back ${bull ? 'above' : 'below'} it` : `closed on the wrong side of it`;
    const rows = [
      `${mark(ev.trend.ok)} Bigger trend: the 20-period average is ${ev.trend.dir === 'flat' ? 'flat' : ev.trend.dir === 'up' ? 'rising' : 'falling'} (${sign(ev.trend.slope)} average ranges over 10 candles).`,
      `${mark(ev.level.ok)} Level: the pattern ${extWord} is ${where}, and it ${closeWord}.`,
      `${mark(ev.size.ok)} Size: the last candle is ${ev.size.ratio.toFixed(1)}× the average range of the 10 candles before the pattern.`,
    ];
    let html = `<p class="verdict">${allRight ? 'All three checks graded correctly.' : `${right} of 3 checks graded correctly.`}</p>
      <p class="verdict-line">By the checklist: ${ev.pass ? 'take the trade.' : 'skip it.'}</p>
      <ul class="checklist">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>`;
    let lines;
    if (ev.pass) {
      const k = q.candles[q.index];
      const pip = q.pair.pip;
      const buffer = Math.max(2 * pip, Math.round((0.1 * ev.atr) / pip) * pip);
      const stop = bull ? ev.extreme - buffer : ev.extreme + buffer;
      const entry = k.c;
      const risk = Math.abs(entry - stop) / pip;
      const dp = q.pair.dp;
      lines = [
        { price: entry, cls: 'entry', label: 'Entry', below: !bull },
        { price: stop, cls: 'stop', label: 'Stop', below: bull },
      ];
      html += `<p class="label">Trade plan</p>
        <p>${bull ? 'Buy' : 'Sell'} at the next candle’s open (about ${entry.toFixed(dp)}). Stop ${bull ? 'below' : 'above'} the pattern ${extWord} at ${stop.toFixed(dp)}: ${risk.toFixed(1)} pips of risk. Size the position from that distance.</p>`;
    } else {
      html += `<p>A ${esc(def.name)} that fails a check is a pattern without an edge. The guide’s advice is to wait for one that lines up.</p>`;
    }
    html += `<p class="cite">Source: <b>Monster Guide</b> pp. 14 and 20 (trend, pullback to support or resistance, a pattern larger than the earlier candles, entry on the next candle’s open). The guide states these in words; the numbers above are this trainer’s way of making them measurable.</p>`;
    drawSetup(lines);
    const fb = $('setup-feedback');
    fb.className = 'feedback ' + (allRight ? 'ok' : 'bad');
    fb.innerHTML = html;
    fb.hidden = false;
    $('setup-check').hidden = true;
    $('setup-next').hidden = false;
    $('setup-next').focus({ preventScroll: true });
    updateScores();
  }

  function updateScores() {
    $('setup-score').textContent = setup.score;
    $('setup-total').textContent = setup.total;
    $('setup-streak').textContent = setup.streak;
    $('drill-score').textContent = drill.score;
    $('drill-total').textContent = drill.total;
    $('drill-streak').textContent = drill.streak;
    $('drill-best').textContent = prefs.best;
    $('spot-score').textContent = spot.score;
    $('spot-total').textContent = spot.total;
    $('spot-streak').textContent = spot.streak;
  }

  // ---------- library ----------
  function buildLibrary() {
    const box = $('lib-cards');
    box.innerHTML = '';
    PATTERNS.forEach((def, n) => {
      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.group = def.group;
      card.dataset.signal = def.signal;
      card.dataset.role = def.role;
      const ex = L.generateDrill(def.id, L.mulberry32(1000 + n * 7919), { length: 12 });
      card.innerHTML = `
        <div class="card-art"><svg class="chart" role="img" aria-label="Example ${esc(def.name)}"></svg></div>
        <div class="card-head"><h3>${esc(def.name)}</h3>${biasChip(def.signal)}</div>
        <div class="card-body">
          <p class="card-meta">${def.candles} candle${def.candles > 1 ? 's' : ''} · ${TREND_LABEL[def.trend]} · ${ROLE_LABEL[def.role]}</p>
          <ul>${def.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          <p class="label">What it suggests</p><p>${esc(def.meaning)}</p>
          <p class="label">Before acting</p><p>${esc(def.confirm)}</p>
          ${notesHtml(def)}${citeHtml(def)}
        </div>
        <div class="card-foot"><span class="card-meta">Shaded: the pattern</span><button type="button" class="ghost">Practise this</button></div>`;
      renderChart(card.querySelector('svg'), ex, { compact: true, width: 320, height: 150, shade: [ex.start, ex.index] });
      card.querySelector('button').addEventListener('click', () => practise(def.id));
      box.appendChild(card);
    });
  }

  function buildSources() {
    const count = (k) => PATTERNS.filter((p) => p.refs.some((r) => r.src === k)).length;
    const used = {
      MG: `Cited by ${count('MG')} patterns, plus the setup checklist and the candle-reading principles.`,
      TP: `Cited by ${count('TP')} patterns, including Three Inside and Three Outside, Hanging Man and Inverted Hammer.`,
    };
    $('source-list').innerHTML = Object.entries(L.SOURCES).map(([k, s]) =>
      `<li><b>${esc(s.title)}</b>, ${esc(s.author)}. ${esc(used[k])}</li>`).join('') +
      '<li>Where the sources describe a shape in words (“small body”, “long shadow”), this trainer turns it into a number, shown in each rule, so every chart is checked the same way.</li>';
    $('source-issues').innerHTML = L.SOURCE_ISSUES.map((t) => `<li>${esc(t)}</li>`).join('');
  }

  function filterLibrary(f) {
    for (const b of $('lib-filter').children) b.setAttribute('aria-pressed', String(b.dataset.f === f));
    for (const c of $('lib-cards').children) {
      c.hidden = !(f === 'all' || c.dataset.group === f || c.dataset.signal === f || c.dataset.role === f);
    }
  }

  function practise(id) {
    setFocus(id);
    showTab('drill');
    newDrill();
  }

  // ---------- progress ----------
  function accCell(a, c) {
    if (!a) return '<span class="measure">–</span>';
    const pct = Math.round((100 * c) / a);
    const cls = pct < 60 ? 'low' : pct >= 85 ? 'high' : '';
    return `<span class="acc"><span class="acc-bar"><i class="${cls}" style="width:${pct}%"></i></span>${pct}% <span class="measure">${c}/${a}</span></span>`;
  }

  function renderProgress() {
    const rows = PATTERNS.map((def) => {
      const s = stat(def.id);
      const mix = Object.entries(s.mix).sort((a, b) => b[1] - a[1])[0];
      return { def, s, mix };
    });
    let a = 0, c = 0, sa = 0, sc = 0;
    rows.forEach(({ s }) => { a += s.a; c += s.c; sa += s.sa; sc += s.sc; });
    const tried = rows.filter((r) => r.s.a >= 3).sort((x, y) => x.s.c / x.s.a - y.s.c / y.s.a);
    const parts = [];
    if (a) parts.push(`Drill: ${c}/${a} correct (${Math.round((100 * c) / a)}%)`);
    if (sa) parts.push(`Spot: ${sc}/${sa} found (${Math.round((100 * sc) / sa)}%)`);
    if (extra.read.a) parts.push(`Candle reading: ${extra.read.c}/${extra.read.a} (${Math.round((100 * extra.read.c) / extra.read.a)}%)`);
    if (extra.setup.a) parts.push(`Setups: ${extra.setup.c}/${extra.setup.a} fully graded (${Math.round((100 * extra.setup.c) / extra.setup.a)}%)`);
    if (tried.length && tried[0].s.c < tried[0].s.a) parts.push(`Weakest so far: ${tried[0].def.name}`);
    $('prog-summary').textContent = parts.length ? parts.join(' · ') + '.' : 'No answers yet. Results from Drill, Spot and Setups appear here, saved in this browser only.';

    $('prog-rows').innerHTML = rows.map(({ def, s, mix }) => `
      <tr>
        <th scope="row">${esc(def.name)}</th>
        <td>${biasChip(def.signal)}</td>
        <td class="num">${s.a + s.sa}</td>
        <td><div>${accCell(s.a, s.c)}</div>${def.spot === false ? '' : `<div class="measure">Spot ${s.sa ? Math.round((100 * s.sc) / s.sa) + '% (' + s.sc + '/' + s.sa + ')' : '–'}</div>`}</td>
        <td class="mixed">${mix ? esc(BY_ID[mix[0]].name) + ' ×' + mix[1] : ''}</td>
        <td><button type="button" class="link" data-practise="${def.id}">Practise</button></td>
      </tr>`).join('');
  }

  // ---------- tabs ----------
  const TABS = ['drill', 'spot', 'setups', 'library', 'progress'];
  function showTab(name) {
    if (!TABS.includes(name)) name = 'drill';
    TABS.forEach((t) => {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('tab-' + t).tabIndex = t === name ? 0 : -1;
      $('panel-' + t).hidden = t !== name;
    });
    prefs.tab = name;
    persist();
    const svg = $(name.replace(/s$/, '') + '-chart');
    if (svg && svg._render) renderChart(svg, ...svg._render); // re-measure now the panel is visible
    if (name === 'spot' && !spot.q) newSpot();
    if (name === 'setups' && !setup.q) newSetup();
    if (name === 'progress') renderProgress();
  }

  // ---------- wiring ----------
  function init() {
    $('drill-mode').value = prefs.mode;
    GROUPS.forEach((g) => {
      $('grp-' + g).checked = prefs.groups[g];
      $('spot-' + g).checked = prefs.spotGroups[g];
      $('grp-' + g).addEventListener('change', (e) => { prefs.groups[g] = e.target.checked; setFocus(null); persist(); newDrill(); });
      $('spot-' + g).addEventListener('change', (e) => { prefs.spotGroups[g] = e.target.checked; persist(); newSpot(); });
    });
    $('opt-highlight').checked = prefs.highlight;
    $('opt-adaptive').checked = prefs.adaptive;
    $('drill-mode').addEventListener('change', (e) => { prefs.mode = e.target.value; persist(); newDrill(); });
    $('opt-highlight').addEventListener('change', (e) => { prefs.highlight = e.target.checked; persist(); if (drill.q) drawDrill(drill.answered); });
    $('opt-adaptive').addEventListener('change', (e) => { prefs.adaptive = e.target.checked; persist(); });
    $('drill-focus-clear').addEventListener('click', () => { setFocus(null); newDrill(); });
    $('drill-next').addEventListener('click', newDrill);
    $('spot-next').addEventListener('click', newSpot);
    $('spot-reveal').addEventListener('click', () => pickSpot(-1, true));
    $('setup-next').addEventListener('click', newSetup);
    $('setup-check').addEventListener('click', checkSetup);
    $('setup-checks').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || setup.done) return;
      const row = b.closest('[data-check]');
      setup.answers[row.dataset.check] = b.dataset.v;
      for (const x of row.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      $('setup-check').disabled = CHECKS.some((c) => !setup.answers[c]);
    });

    TABS.forEach((t, n) => {
      const b = $('tab-' + t);
      b.addEventListener('click', () => showTab(t));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = TABS[(n + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        showTab(next);
        $('tab-' + next).focus();
      });
    });

    $('lib-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) filterLibrary(b.dataset.f); });
    $('prog-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-practise]'); if (b) practise(b.dataset.practise); });
    $('prog-reset').addEventListener('click', () => { $('prog-confirm').hidden = false; $('prog-reset').hidden = true; });
    $('prog-reset-no').addEventListener('click', () => { $('prog-confirm').hidden = true; $('prog-reset').hidden = false; });
    $('prog-reset-yes').addEventListener('click', () => {
      for (const k of Object.keys(stats)) delete stats[k];
      extra.read = { a: 0, c: 0 };
      extra.setup = { a: 0, c: 0 };
      prefs.best = 0;
      persist();
      $('prog-confirm').hidden = true;
      $('prog-reset').hidden = false;
      updateScores();
      renderProgress();
    });

    document.addEventListener('keydown', (e) => {
      if ($('panel-drill').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'select' || tag === 'input') return;
      if (!drill.answered && /^[1-5]$/.test(e.key)) {
        const b = $('drill-options').children[+e.key - 1];
        if (b) { e.preventDefault(); b.click(); }
      } else if (drill.answered && e.key === 'Enter' && e.target === document.body) {
        e.preventDefault();
        newDrill();
      }
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const id of ['drill-chart', 'spot-chart', 'setup-chart']) {
          const svg = $(id);
          if (svg._render && svg.getBoundingClientRect().width) renderChart(svg, ...svg._render);
        }
      }, 150);
    });

    buildLibrary();
    buildSources();
    newDrill();
    updateScores();
    const hash = location.hash.replace('#', '');
    showTab(TABS.includes(hash) ? hash : prefs.tab);
  }

  init();
})();
