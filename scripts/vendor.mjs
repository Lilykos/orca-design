// Bundles npm code the plugin needs at runtime: Orca frames cannot import bare packages and the
// worker must not depend on node_modules. Run after changing zod or tools/dc.ts.
import { build } from 'esbuild'
import { existsSync } from 'node:fs'

await build({
  stdin: { contents: "export * from 'zod'", resolveDir: process.cwd() },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  minify: true,
  legalComments: 'inline',
  outfile: 'vendor/zod.js'
})

if (existsSync('tools/dc.ts')) {
  await build({
    entryPoints: ['tools/dc.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node\n// Design canvas agent CLI (generated from tools/dc.ts).' },
    outfile: 'assets/dc.mjs'
  })
}
