#!/usr/bin/env node
// Bundles the extension into extension/build/ so Chrome can load it unpacked.

import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'extension/build');
const watch = process.argv.includes('--watch');

if (!existsSync(join(ROOT, 'dist/dataset.json'))) {
  console.error('dist/dataset.json is missing -- run `npm run build:data` first.');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

// Personal, gitignored inputs under data/local/ are inlined at build time (see README).
const readLocal = (f) => (existsSync(join(ROOT, 'data/local', f)) ? readFileSync(join(ROOT, 'data/local', f), 'utf8') : null);
const localConfig = readLocal('config.json');
const localKeepers = readLocal('keepers.tsv');
const define = {
  __LOCAL_DEFAULTS__: localConfig ? JSON.stringify(JSON.parse(localConfig)) : 'null',
  __SEED_KEEPER_PASTE__: localKeepers ? JSON.stringify(localKeepers.trimEnd()) : 'null',
};

const common = {
  define,
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  logLevel: 'info',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
};

const builds = [
  // background is declared "type": "module"; the options and standalone pages load as
  // <script type="module">. The content script is a CLASSIC script, so it must be iife.
  { entryPoints: [join(ROOT, 'src/background/index.js')], outfile: join(OUT, 'background.js'), ...common },
  { entryPoints: [join(ROOT, 'src/content/index.js')],    outfile: join(OUT, 'content.js'),    ...common, format: 'iife' },
  { entryPoints: [join(ROOT, 'src/options/options.js')],  outfile: join(OUT, 'options.js'),    ...common },
  { entryPoints: [join(ROOT, 'src/panel/standalone.js')], outfile: join(OUT, 'standalone.js'), ...common },
];

async function copyStatic() {
  await copyFile(join(ROOT, 'src/panel/panel.css'), join(OUT, 'panel.css'));
  await copyFile(join(ROOT, 'src/options/options.html'), join(OUT, 'options.html'));
  await copyFile(join(ROOT, 'src/options/options.css'), join(OUT, 'options.css'));
  await copyFile(join(ROOT, 'src/panel/standalone.html'), join(OUT, 'standalone.html'));
  await copyFile(join(ROOT, 'dist/dataset.json'), join(OUT, 'dataset.json'));
}

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.watch();
  }
  await copyStatic();
  console.log('watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  await copyStatic();
  const size = async (f) => ((await readFile(join(OUT, f))).length / 1024).toFixed(0);
  console.log(`\n  background.js ${await size('background.js')} KB`);
  console.log(`  content.js    ${await size('content.js')} KB`);
  console.log(`  options.js    ${await size('options.js')} KB`);
  console.log(`  dataset.json  ${await size('dataset.json')} KB`);
  console.log(`\nLoad unpacked from: ${join(ROOT, 'extension')}`);
}
