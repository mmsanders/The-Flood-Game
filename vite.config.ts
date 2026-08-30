import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two entry points sharing one source tree:
//   index.html      -> the game       -> /
//   dev/index.html  -> the dev tool   -> /dev/
//
// `base` is overridable so the GitHub Pages build can be served from a
// subpath (/<repo>/) while local dev stays at the root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        devtool: resolve(__dirname, 'dev/index.html'),
      },
    },
  },
});
