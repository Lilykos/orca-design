import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { utimesSync } from 'node:fs'
import path from 'node:path'
import { makeRoot, workspaces } from '../tests/helpers.ts'
import * as main from './index.ts'
import { initCanvas } from './store.ts'
import { resetWorkspaceCache } from './workspace.ts'

async function boot(map: Record<string, string>) {
  resetWorkspaceCache()
  const host = mockHost({ results: { ...workspaces(map), 'workspace.open': { opened: true }, 'editor.open': { opened: true }, 'statusBar.update': {} } })
  return { host, worker: await mountWorker(main, { host }) }
}

test('dc.home lists designs from every workspace that uses the canvas, newest first', async () => {
  const a = makeRoot(['minimal'])
  const b = makeRoot(['sample-alternatives'])
  const plain = makeRoot([])
  await initCanvas(a)
  await initCanvas(b)
  const old = new Date('2026-01-01')
  utimesSync(path.join(a, 'design/minimal/a.html'), old, old)
  utimesSync(path.join(a, 'design/minimal/design.json'), old, old)
  utimesSync(path.join(a, 'design/minimal/style.css'), old, old)
  utimesSync(path.join(a, 'design/minimal/assets/p.png'), old, old)
  const { worker } = await boot({ wa: a, wb: b, wp: plain })
  const home = await worker.request('dc.home', {})
  assert.deepEqual(home.designs.map((d) => `${d.ws}/${d.slug}`), ['wb/sample-alternatives', 'wa/minimal'])
  assert.equal(home.workspaces.length, 3)
  await worker.deactivate()
})

test('dc.cover streams the first artboard in chunks', async () => {
  const a = makeRoot(['minimal'])
  await initCanvas(a)
  const { worker } = await boot({ wa: a })
  const part = await worker.request('dc.cover', { ws: 'wa', slug: 'minimal', offset: 0 })
  assert.equal(part.done, true)
  assert.equal(part.width, 390)
  assert.match(part.chunk, /Tom &amp; Jerry/)
  assert.ok(typeof part.version === 'string' && part.version.length > 0)
  await worker.deactivate()
})

test('dc.open shows the workspace, then opens its canvas on that design', async () => {
  const a = makeRoot(['minimal'])
  await initCanvas(a)
  const { host, worker } = await boot({ wa: a })
  await worker.request('dc.open', { ws: 'wa', slug: 'minimal' })
  const order = host.calls.map((c) => c.method).filter((m) => m === 'workspace.open' || m === 'editor.open')
  assert.deepEqual(order, ['workspace.open', 'editor.open'])
  assert.equal(host.data().storage['open:wa'], 'minimal')
  await worker.deactivate()
})
