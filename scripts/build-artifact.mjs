/**
 * Bundle the world inspector into one self-contained HTML file.
 *
 * Published Artifacts can't fetch sibling assets, so the CSS and JS have to be
 * inlined and the whole app has to land in a single chunk. The output is body
 * content only — the Artifact host supplies the document skeleton.
 *
 *   node scripts/build-artifact.mjs [outfile]
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist-artifact');
const outFile = process.argv[2] ?? resolve(root, 'dist-artifact/inspector.html');

await rm(outDir, { recursive: true, force: true });

// One HTML entry means no shared-chunk splitting: everything lands in one file.
await build({
  root,
  base: './',
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: resolve(root, 'dev/index.html'),
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
      },
    },
  },
});

const html = await readFile(resolve(outDir, 'dev/index.html'), 'utf8');
const js = await readFile(resolve(outDir, 'app.js'), 'utf8');
const css = await readFile(resolve(outDir, 'app.css'), 'utf8');

const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'World Inspector';
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';

// Drop the built tags that pointed at the now-inlined files.
const markup = body
  .replace(/<script\b[^>]*><\/script>/g, '')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '')
  .trim();

const out = `<title>${title}</title>
<style>
${css}
</style>

${markup}

<script type="module">
${js}
</script>
`;

await writeFile(outFile, out, 'utf8');
console.log(`Wrote ${outFile} (${(out.length / 1024).toFixed(0)} KB)`);
