import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const result = await esbuild.build({
  entryPoints: [path.join(rootDir, 'ui', 'app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  write: false,
});

const jsCode = result.outputFiles[0].text;
const template = fs.readFileSync(path.join(rootDir, 'ui', 'template.html'), 'utf8');
const safeInlineJs = jsCode.replace(/<\/script>/gi, '<\\/script>');
const finalHtml = template.replace(
  '<!-- INLINED_BUNDLE -->',
  `<script type="module">\n${safeInlineJs}\n</script>`
);

const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'app.html');
fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log(`Built single-file MCP App UI -> ${outPath} (${(Buffer.byteLength(finalHtml) / 1024).toFixed(1)} KB)`);
