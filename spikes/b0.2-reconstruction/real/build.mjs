// Bundles entry.ts with the repository's own vite (no install here, no change
// to the root package.json): the `@/` alias and TypeScript of src/ need it.
// Packages stay external and load from the root node_modules at run time.
//   node real/build.mjs   (after `pnpm install` in the repository root)
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  configFile: false,
  logLevel: 'warn',
  root: here('.'),
  resolve: { alias: { '@': here('../../../src') } },
  build: {
    ssr: here('entry.ts'),
    outDir: here('../out/real'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: 'real.mjs' } },
  },
});
