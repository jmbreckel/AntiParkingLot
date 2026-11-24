import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIAGRAMS_DIR = path.join(ROOT, 'documentation', 'diagrams');
const MERMAID_JS = path.join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const SCALE_FACTOR = 4; // 4x resolution rasterization

function findBrowserExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find local Chrome/Edge executable. Set CHROME_PATH environment variable.');
}

async function main() {
  if (!fs.existsSync(MERMAID_JS)) {
    throw new Error(`Missing mermaid bundle at ${MERMAID_JS}. Run npm install first.`);
  }

  const mmdFiles = fs
    .readdirSync(DIAGRAMS_DIR)
    .filter((f) => f.endsWith('.mmd'))
    .sort();

  if (mmdFiles.length === 0) {
    console.log('No .mmd files found in documentation/diagrams.');
    return;
  }

  const executablePath = findBrowserExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: {
      width: 2400,
      height: 1800,
      deviceScaleFactor: SCALE_FACTOR,
    },
  });

  try {
    const page = await browser.newPage();

    for (const file of mmdFiles) {
      const mmdPath = path.join(DIAGRAMS_DIR, file);
      const pngPath = path.join(DIAGRAMS_DIR, file.replace(/\.mmd$/, '.png'));
      const definition = fs.readFileSync(mmdPath, 'utf8');

      await page.setViewport({
        width: 2400,
        height: 1800,
        deviceScaleFactor: SCALE_FACTOR,
      });

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #0f172a;
    }
    #capture {
      display: inline-block;
      padding: 36px 44px;
      background: #0f172a;
    }
    svg {
      display: block;
      max-width: none !important;
      height: auto;
    }
  </style>
</head>
<body>
  <div id="capture">
    <pre class="mermaid">${definition
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>
  </div>
</body>
</html>`;

      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ path: MERMAID_JS });

      await page.evaluate(async () => {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          fontFamily: 'Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
          flowchart: { htmlLabels: true, curve: 'basis', padding: 18, useMaxWidth: false },
          sequence: { actorMargin: 60, messageMargin: 38, boxMargin: 12, useMaxWidth: false },
          state: { useMaxWidth: false },
          themeVariables: {
            darkMode: true,
            background: '#0f172a',
            primaryColor: '#1e293b',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#38bdf8',
            lineColor: '#94a3b8',
            secondaryColor: '#312e81',
            tertiaryColor: '#1e293b',
            clusterBkg: '#162033',
            clusterBorder: '#475569',
            actorBkg: '#1e293b',
            actorBorder: '#38bdf8',
            actorTextColor: '#f8fafc',
            signalColor: '#e2e8f0',
            noteBkgColor: '#312e81',
            noteTextColor: '#e0e7ff',
            noteBorderColor: '#818cf8',
          },
        });
        await window.mermaid.run({ querySelector: '.mermaid' });
      });

      const initialBox = await page.$eval('#capture', (el) => {
        const r = el.getBoundingClientRect();
        return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
      });

      if (initialBox.width > 2350 || initialBox.height > 1750) {
        await page.setViewport({
          width: initialBox.width + 80,
          height: initialBox.height + 80,
          deviceScaleFactor: SCALE_FACTOR,
        });
      }

      const finalBox = await page.$eval('#capture', (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(r.x)),
          y: Math.max(0, Math.floor(r.y)),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        };
      });

      await page.screenshot({
        path: pngPath,
        type: 'png',
        clip: finalBox,
      });

      const outPixels = {
        width: finalBox.width * SCALE_FACTOR,
        height: finalBox.height * SCALE_FACTOR,
      };
      console.log(
        `Rendered 4x PNG: ${path.basename(pngPath)} (${outPixels.width}x${outPixels.height} px, ${(
          fs.statSync(pngPath).size / 1024
        ).toFixed(1)} KB)`
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
