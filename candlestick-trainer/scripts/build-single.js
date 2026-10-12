// Inline the stylesheet and scripts into one self-contained HTML file.
// Usage: node scripts/build-single.js [out.html] [--fragment]
//   --fragment  omit doctype/html/head/body (for hosts that add their own skeleton)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'wick-reader.html');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
const body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0];
const css = read('css/styles.css');
const js = read('js/patterns.js') + '\n' + read('js/app.js');
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

const inner = `${title}
${fonts}
<style>
${css}
</style>
${body}
<script>
${guard(js)}
</script>
`;

const doc = fragment
  ? inner
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${inner.replace(body, '').replace(/<script>[\s\S]*<\/script>\n/, '')}</head>
<body>
${body}
<script>
${guard(js)}
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`Wrote ${out} (${(doc.length / 1024).toFixed(1)} KB)`);
