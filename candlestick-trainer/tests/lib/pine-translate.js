// Translates a small subset of Pine Script v6 to JavaScript for parity tests:
// expressions, one-line and block functions (last line = return value, tuples as arrays),
// for/if blocks, := reassignment and typed declarations. Series built-ins (ta.*) are not
// translated; the test harness supplies them. Pine syntax itself is not checked here.

function expr(e) {
  return e
    .replace(/\bna\(([^()]+)\)/g, 'Number.isNaN($1)')
    .replace(/\bna\b/g, 'NaN')
    .replace(/\.size\(\)/g, '.length')
    .replace(/\.get\(([^()]+)\)/g, '[$1]')
    .replace(/\bmaLine\[([^\]]+)\]/g, 'maLine($1)')
    .replace(/\bavgRange\[([^\]]+)\]/g, 'avgRange($1)')
    .replace(/\b(high|low|open|close)\[([^\]]+)\]/g, 'bar.$1($2)')
    .replace(/(?<![.\w])(high|low|open|close)\b(?!\()/g, 'bar.$1(0)')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\s+/g, '!')
    .replace(/\bmath\.(abs|max|min)\b/g, 'Math.$1');
}

// Translate the part of a Pine file between two section markers.
function translate(src, startMarker = '// ───────────── candle helpers', endMarker = '// ───────────── marking') {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0) throw new Error('markers not found: ' + startMarker + ' / ' + endMarker);
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
    const line = raw.trim().replace(/^\[([^\]]+)\]$/, 'return [$1]');
    if (line.startsWith('return [')) { out.push(line.replace(/\bna\b/g, 'NaN') + ';'); continue; }
    if (/^\w+\s*=\s*ta\./.test(line)) continue; // series built-ins are supplied by the harness
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
    if ((m = line.match(/^(?:float|int|bool|string)\s+(\w+)\s+=\s+(.+)$/))) { out.push(`let ${m[1]} = ${expr(m[2])};`); continue; }
    throw new Error('Untranslated Pine line: ' + line);
  }
  close(0);
  return out.join('\n');
}

function extractFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.startsWith(name + '('));
  let k = i + 1;
  while (k < lines.length && (lines[k].startsWith(' ') || !lines[k].trim())) k++;
  return lines.slice(i, k).join('\n');
}

module.exports = { expr, translate, extractFn };
