import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
await build({ build: { target: 'es2022' } });
for (const entry of ['background', 'capture']) {
  await build({ build: { emptyOutDir: false, target: 'es2022', lib: {
    entry: `src/${entry}.ts`, name: entry === 'capture' ? 'HaruhiCapture' : entry, formats: ['iife'], fileName: () => `${entry}.js`
  } } });
}
await copyFile('manifest.json', 'dist/manifest.json');
