import { assert, test } from 'orca/testing'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot } from '../tests/helpers.ts'
import { isInitialized, listSlugs, readDesignAgents, readManifest, summarize, viewArtboard, viewDesignMeta } from './store.ts'

test('listSlugs ignores trash, dotfolders and folders without design.json', async () => {
  const root = makeRoot()
  mkdirSync(path.join(root, 'design/.trash/old'), { recursive: true })
  mkdirSync(path.join(root, 'design/systems'))
  assert.deepEqual(await listSlugs(root), ['minimal', 'sample-alternatives'])
})

test('readManifest reports half-written JSON', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/minimal/design.json'), '{"version":1,')
  const r = await readManifest(root, 'minimal')
  assert.equal(r.manifest, null)
  assert.match(r.error ?? '', /JSON/)
})

test('isInitialized accepts either the Orca entry or the Paseo marker', async () => {
  const root = makeRoot(['minimal'])
  assert.equal(await isInitialized(root), false)
  writeFileSync(path.join(root, 'design/canvas.json'), '{"version":1}')
  assert.equal(await isInitialized(root), true)
})

test('readDesignAgents prefers canvas.design.json and falls back to canvas.json', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.json'), JSON.stringify({ version: 1, agents: { minimal: 'paseo-agent' } }))
  assert.deepEqual(await readDesignAgents(root), { minimal: 'paseo-agent' })
  writeFileSync(path.join(root, 'design/canvas.design.json'), JSON.stringify({ version: 1, agents: { minimal: 'orca-session' } }))
  assert.deepEqual(await readDesignAgents(root), { minimal: 'orca-session' })
})

test('summarize counts artboards of the sample design', async () => {
  const root = makeRoot()
  const s = await summarize(root, 'sample-alternatives')
  assert.equal(s.artboards, 6)
  assert.equal(s.error, null)
})

test('viewDesignMeta carries versions but no html', async () => {
  const root = makeRoot()
  const v = await viewDesignMeta(root, 'minimal')
  assert.equal(v.artboards.length, 1)
  assert.equal(v.artboards[0]!.html, null)
  assert.ok(v.artboards[0]!.version.length > 0)
})

test('viewArtboard inlines local CSS and images', async () => {
  const root = makeRoot(['minimal'])
  const a = await viewArtboard(root, 'minimal', 'a')
  assert.match(a.html ?? '', /data:image\/png;base64,/)
  assert.match(a.html ?? '', /font:16px system-ui/)
})
