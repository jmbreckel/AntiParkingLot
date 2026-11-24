#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PLUGIN_MANIFEST_PATH = path.join(ROOT_DIR, 'plugin.json');
const GEMINI_CONFIG_DIR = path.join(os.homedir(), '.gemini', 'config');
const PLUGINS_JSON_PATH = path.join(GEMINI_CONFIG_DIR, 'plugins.json');
const PLUGINS_DIR = path.join(GEMINI_CONFIG_DIR, 'plugins');
const PLUGIN_DATA_DIR = path.join(GEMINI_CONFIG_DIR, 'plugin-data');

function printHelp() {
  console.log(`
AntiParkingLot Global Installer for Antigravity

Usage:
  node scripts/install-global.mjs [options]
  npm run install:global [-- options]
  npm run uninstall:global

Options:
  --mode=<register|link|copy>  Install strategy (default: register)
                                 register: zero-copy entry in ~/.gemini/config/plugins.json
                                 link:     junction/symlink in ~/.gemini/config/plugins/<name>
                                 copy:     standalone copy in ~/.gemini/config/plugins/<name>
  --uninstall                  Remove global registration / installed plugin copy
  --skip-install               Skip running "npm install"
  --skip-build                 Skip running "npm run build"
  -h, --help                   Show this help message
`.trim());
}

function parseArgs(argv) {
  const opts = {
    mode: 'register',
    uninstall: false,
    skipInstall: false,
    skipBuild: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--uninstall') {
      opts.uninstall = true;
    } else if (arg === '--skip-install') {
      opts.skipInstall = true;
    } else if (arg === '--skip-build') {
      opts.skipBuild = true;
    } else if (arg.startsWith('--mode=')) {
      opts.mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['register', 'link', 'copy'].includes(opts.mode)) {
    throw new Error(`Invalid --mode "${opts.mode}". Expected one of: register, link, copy.`);
  }

  return opts;
}

function readPluginManifest() {
  const raw = fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    name: parsed.name || path.basename(ROOT_DIR),
    displayName: parsed.displayName || parsed.name || path.basename(ROOT_DIR),
    version: parsed.version || '0.0.0',
  };
}

function toPosix(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeForCompare(p) {
  const expanded = p.startsWith('~/') || p.startsWith('~\\')
    ? path.join(os.homedir(), p.slice(2))
    : p;
  const posix = toPosix(path.resolve(expanded));
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

function runNpm(args) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const cmdArgs = isWin ? ['/d', '/s', '/c', 'npm', ...args] : args;
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`Command "npm ${args.join(' ')}" exited with status ${res.status}`);
  }
}

function readPluginsJson() {
  if (!fs.existsSync(PLUGINS_JSON_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(PLUGINS_JSON_PATH, 'utf8').trim();
  if (!raw) {
    return { entries: [] };
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${PLUGINS_JSON_PATH}`);
  }
  return parsed;
}

function writePluginsJson(config) {
  fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
  const tmpPath = `${PLUGINS_JSON_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, PLUGINS_JSON_PATH);
}

function registerInPluginsJson() {
  const parentDir = path.dirname(ROOT_DIR);
  const repoFolderName = path.basename(ROOT_DIR);
  const parentPosix = toPosix(parentDir);
  const targetParentNorm = normalizeForCompare(parentDir);

  const config = readPluginsJson() || {};
  if (!Array.isArray(config.entries)) {
    config.entries = [];
  }

  let matched = false;
  for (const entry of config.entries) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (normalizeForCompare(entry.path) !== targetParentNorm) continue;

    matched = true;
    if (Array.isArray(entry.include_only)) {
      if (!entry.include_only.includes(repoFolderName)) {
        entry.include_only.push(repoFolderName);
      }
    }
    if (Array.isArray(entry.exclude)) {
      entry.exclude = entry.exclude.filter((item) => item !== repoFolderName);
      if (entry.exclude.length === 0) {
        delete entry.exclude;
      }
    }
    break;
  }

  if (!matched) {
    config.entries.push({
      path: parentPosix,
      include_only: [repoFolderName],
    });
  }

  writePluginsJson(config);
  return { parentPosix, repoFolderName };
}

function removeFromPluginsJson() {
  const config = readPluginsJson();
  if (!config || !Array.isArray(config.entries)) {
    return false;
  }

  const parentDir = path.dirname(ROOT_DIR);
  const repoFolderName = path.basename(ROOT_DIR);
  const targetParentNorm = normalizeForCompare(parentDir);

  let changed = false;
  const nextEntries = [];

  for (const entry of config.entries) {
    if (!entry || typeof entry.path !== 'string' || normalizeForCompare(entry.path) !== targetParentNorm) {
      nextEntries.push(entry);
      continue;
    }

    if (Array.isArray(entry.include_only)) {
      const filtered = entry.include_only.filter((item) => item !== repoFolderName);
      if (filtered.length !== entry.include_only.length) {
        changed = true;
      }
      if (filtered.length > 0) {
        nextEntries.push({ ...entry, include_only: filtered });
      }
      // If include_only is now empty, drop the entire entry.
    } else {
      nextEntries.push(entry);
    }
  }

  if (changed) {
    config.entries = nextEntries;
    writePluginsJson(config);
  }
  return changed;
}

function removeInstalledDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  const stat = fs.lstatSync(dirPath);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dirPath);
  } else {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  return true;
}

function copyPluginDirectory(srcDir, destDir) {
  const skipNames = new Set(['.git', '.github', '.vscode']);
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const rel = path.relative(srcDir, sourcePath);
      if (!rel) return true;
      const top = rel.split(path.sep)[0];
      return !skipNames.has(top);
    },
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const manifest = readPluginManifest();
  const pluginDestDir = path.join(PLUGINS_DIR, manifest.name);

  if (opts.uninstall) {
    const removedJson = removeFromPluginsJson();
    const removedDir = removeInstalledDir(pluginDestDir);

    if (removedJson) {
      console.log(`Removed "${path.basename(ROOT_DIR)}" entry from ${PLUGINS_JSON_PATH}`);
    }
    if (removedDir) {
      console.log(`Removed ${pluginDestDir}`);
    }
    if (!removedJson && !removedDir) {
      console.log(`No global installation of "${manifest.name}" was found.`);
    } else {
      console.log(`\nUninstalled ${manifest.displayName} globally.`);
      console.log(`Saved data (if any) was preserved at: ${path.join(PLUGIN_DATA_DIR, manifest.name)}`);
    }
    return;
  }

  console.log(`Installing ${manifest.displayName} (${manifest.name} v${manifest.version}) globally...\n`);

  if (!opts.skipInstall) {
    console.log('1/3 Installing npm dependencies...');
    runNpm(['install']);
  } else {
    console.log('1/3 Skipping npm install (--skip-install).');
  }

  if (!opts.skipBuild) {
    console.log('\n2/3 Building single-file MCP App UI...');
    runNpm(['run', 'build']);
  } else {
    console.log('\n2/3 Skipping UI build (--skip-build).');
  }

  const distHtmlPath = path.join(ROOT_DIR, 'dist', 'app.html');
  if (!fs.existsSync(distHtmlPath)) {
    throw new Error(`Expected built UI at ${distHtmlPath}. Run without --skip-build.`);
  }

  console.log(`\n3/3 Registering globally (mode: ${opts.mode})...`);

  if (opts.mode === 'register') {
    if (fs.existsSync(pluginDestDir)) {
      console.warn(
        `Warning: ${pluginDestDir} already exists. Removing it to avoid duplicate plugin name collisions...`
      );
      removeInstalledDir(pluginDestDir);
    }
    const { parentPosix, repoFolderName } = registerInPluginsJson();
    console.log(`Registered "${repoFolderName}" (under ${parentPosix}) in ${PLUGINS_JSON_PATH}`);
  } else if (opts.mode === 'link') {
    removeFromPluginsJson();
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    removeInstalledDir(pluginDestDir);
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(ROOT_DIR, pluginDestDir, linkType);
    console.log(`Linked ${pluginDestDir} -> ${ROOT_DIR} (${linkType})`);
  } else if (opts.mode === 'copy') {
    removeFromPluginsJson();
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    removeInstalledDir(pluginDestDir);
    copyPluginDirectory(ROOT_DIR, pluginDestDir);
    console.log(`Copied plugin bundle to ${pluginDestDir}`);
  }

  console.log(`
Done! ${manifest.displayName} is now installed globally for Antigravity.

Next steps:
  - Antigravity discovers new global plugins automatically (no restart needed).
  - Open "Parking Lot" from the right-hand Side Pane "+" menu or the Left Sidebar.
  - If updating an already-running server, restart the "parking-lot" server in MCP Servers settings.
  - Stored data lives at: ${path.join(PLUGIN_DATA_DIR, manifest.name, 'parking_lot.json')}
`.trim());
}

try {
  main();
} catch (err) {
  console.error(`\nInstall failed: ${err.message}`);
  process.exit(1);
}
