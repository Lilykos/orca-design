import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot, workspaces } from '../tests/helpers.ts'
import * as main from './index.ts'
import { inlineHtml } from './inline.ts'
import { resetWorkspaceCache } from './workspace.ts'
import '../shared/protocol.ts'

async function boot(root: string) {
  resetWorkspaceCache()
  return mountWorker(main, { host: mockHost({ results: workspaces({ w1: root }) }) })
}

const isCatchUp = (post: { payload?: unknown }) => JSON.stringify(post.payload) === JSON.stringify({ ws: 'w1', slugs: [], list: true })

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
}

test('context reports uninitialized without creating files', async () => {
  const root = makeRoot([])
  const worker = await boot(root)
  const ctx = await worker.request('dc.context', { ws: 'w1' })
  assert.equal(ctx.initialized, false)
  assert.equal(existsSync(path.join(root, 'design/canvas.design.json')), false)
  await worker.deactivate()
})

test('unknown workspace is invalid_params', async () => {
  const worker = await boot(makeRoot([]))
  await assert.rejects(worker.request('dc.list', { ws: 'nope' }), (e: any) => e.code === 'invalid_params')
  await worker.deactivate()
})

test('artboard chunks reassemble a 2 MiB page', async () => {
  const root = makeRoot(['minimal'])
  // A PNG-sized blob of incompressible bytes, inlined as base64 (~2 MB of text).
  const bytes = Buffer.alloc(1_500_000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24
  writeFileSync(path.join(root, 'design/minimal/assets/p.png'), bytes)
  const worker = await boot(root)
  let offset = 0
  let joined = ''
  for (;;) {
    const part = await worker.request('dc.artboard', { ws: 'w1', slug: 'minimal', artboardId: 'a', offset })
    assert.ok(JSON.stringify(part).length < 1024 * 1024)
    joined += part.chunk
    offset = part.offset
    if (part.done) break
  }
  const file = path.join(root, 'design/minimal/a.html')
  const expected = await inlineHtml((await import('node:fs')).readFileSync(file, 'utf8'), file, path.join(root, 'design'))
  assert.ok(joined.length > 1_900_000)
  assert.equal(joined, expected.html)
  await worker.deactivate()
})

test('design view reports a broken manifest and recovers', async () => {
  const root = makeRoot(['minimal'])
  const manifest = path.join(root, 'design/minimal/design.json')
  const good = (await import('node:fs')).readFileSync(manifest, 'utf8')
  const worker = await boot(root)
  writeFileSync(manifest, '{"version":1,')
  const broken = await worker.request('dc.design', { ws: 'w1', slug: 'minimal' })
  assert.equal(broken.manifest, null)
  assert.match(broken.error ?? '', /JSON/)
  writeFileSync(manifest, good)
  const fixed = await worker.request('dc.design', { ws: 'w1', slug: 'minimal' })
  assert.equal(fixed.manifest?.title, 'Minimal')
  assert.equal(fixed.artboards[0]!.html, null)
  await worker.deactivate()
})

test('a stale move is refused with code conflict', async () => {
  const worker = await boot(makeRoot(['minimal']))
  await assert.rejects(
    worker.request('dc.moveElement', { ws: 'w1', slug: 'minimal', artboardId: 'a', dcId: 'p', style: { translate: '1px 1px' }, expected: 'stale' }),
    (e: any) => e.code === 'conflict'
  )
  await worker.deactivate()
})

test('bad input is invalid_params', async () => {
  const worker = await boot(makeRoot(['minimal']))
  await assert.rejects(worker.request('dc.design', { ws: 'w1', slug: '../etc' } as any), (e: any) => e.code === 'invalid_params')
  await worker.deactivate()
})

test('watch posts a catch-up change once armed, for writes made while FSEvents starts', async () => {
  const worker = await boot(makeRoot(['minimal']))
  await worker.request('dc.watch', { ws: 'w1' })
  await until(() => worker.posts.some(isCatchUp), 2000)
  assert.ok(worker.posts.some(isCatchUp))
  await worker.deactivate()
})

test('watch posts once per burst, naming the design', async () => {
  const root = makeRoot(['minimal'])
  const worker = await boot(root)
  await worker.request('dc.watch', { ws: 'w1' })
  // Wait until FSEvents really delivers (a probe write shows up), however slow it is under load.
  const probe = path.join(root, 'design/minimal/probe.txt')
  const seesProbe = () => worker.posts.some((p) => JSON.stringify(p.payload) === JSON.stringify({ ws: 'w1', slugs: ['minimal'], list: false }))
  for (let i = 0; i < 40 && !seesProbe(); i++) {
    writeFileSync(probe, String(i))
    await until(seesProbe, 250)
  }
  assert.ok(seesProbe(), 'the watcher never delivered a probe write')
  await new Promise((r) => setTimeout(r, 400))
  const armed = worker.posts.length
  const page = path.join(root, 'design/minimal/a.html')
  for (let i = 0; i < 3; i++) writeFileSync(page, `<p data-dc-id="p">v${i}</p>`)
  writeFileSync(path.join(root, 'design/minimal/.!123!a.html'), 'temp')
  await until(() => worker.posts.length > armed)
  await new Promise((r) => setTimeout(r, 400))
  const changes = worker.posts.slice(armed).filter((p) => p.event === 'dc.changed')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0]!.payload, { ws: 'w1', slugs: ['minimal'], list: false })
  await worker.deactivate()
})

test('dc.version changes when a page changes, without inlining', async () => {
  const root = makeRoot(['minimal'])
  const worker = await boot(root)
  const before = await worker.request('dc.version', { ws: 'w1', slug: 'minimal' })
  await new Promise((r) => setTimeout(r, 20))
  writeFileSync(path.join(root, 'design/minimal/a.html'), '<p data-dc-id="p">changed, longer</p>')
  const after = await worker.request('dc.version', { ws: 'w1', slug: 'minimal' })
  assert.notEqual(after.version, before.version)
  await worker.deactivate()
})

async function bootMany(map: Record<string, string>, focused: string | null) {
  resetWorkspaceCache()
  const host = mockHost({
    results: { ...workspaces(map), 'workspace.readContext': focused ? { workspaceId: focused, branch: 'main', displayName: 'x', terminals: [] } : null }
  })
  return mountWorker(main, { host })
}

test('dc.locate finds the workspace whose canvas entry has the document id', async () => {
  const a = makeRoot([])
  const b = makeRoot([])
  writeFileSync(path.join(a, 'design/canvas.design.json'), '{"version":1,"id":"aaa"}')
  writeFileSync(path.join(b, 'design/canvas.design.json'), '{"version":1,"id":"bbb"}')
  const worker = await bootMany({ wa: a, wb: b }, 'wa')
  assert.deepEqual(await worker.request('dc.locate', { text: '{"version":1,"id":"bbb"}' }), { ws: 'wb' })
  await worker.deactivate()
})

test('dc.locate prefers the focused workspace when worktrees share the entry', async () => {
  const a = makeRoot([])
  const b = makeRoot([])
  for (const r of [a, b]) writeFileSync(path.join(r, 'design/canvas.design.json'), '{"version":1,"id":"same"}')
  const worker = await bootMany({ wa: a, wb: b }, 'wb')
  assert.deepEqual(await worker.request('dc.locate', { text: '{"version":1,"id":"same"}' }), { ws: 'wb' })
  await worker.deactivate()
})

test('dc.locate matches an entry without id by its text, and gives null when nothing matches', async () => {
  const a = makeRoot([])
  writeFileSync(path.join(a, 'design/canvas.design.json'), '{ "version": 1 }\n')
  const worker = await bootMany({ wa: a }, null)
  assert.deepEqual(await worker.request('dc.locate', { text: '{ "version": 1 }\n' }), { ws: 'wa' })
  assert.deepEqual(await worker.request('dc.locate', { text: '{"version":1,"id":"zzz"}' }), { ws: null })
  await worker.deactivate()
})

test('a workspace opened at design/ itself resolves to the folder above it', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.design.json'), '{"version":1,"id":"inner"}')
  const worker = await bootMany({ wd: path.join(root, 'design') }, null)
  assert.deepEqual(await worker.request('dc.locate', { text: '{"version":1,"id":"inner"}' }), { ws: 'wd' })
  const list = await worker.request('dc.list', { ws: 'wd' })
  assert.deepEqual(list.designs.map((d) => d.slug), ['minimal'])
  await worker.deactivate()
})
