import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { makeRoot, workspaces } from '../tests/helpers.ts'
import * as main from './index.ts'
import { resetWorkspaceCache } from './workspace.ts'

const ctx = (id: string) => ({ workspaceId: id, branch: 'main', displayName: 'x', terminals: [] })

async function boot(map: Record<string, string>, focused: string) {
  resetWorkspaceCache()
  const host = mockHost({ results: { ...workspaces(map), 'workspace.readContext': ctx(focused), 'editor.open': { opened: true }, 'statusBar.update': {} } })
  return { host, worker: await mountWorker(main, { host }) }
}

test('Open canvas sets the focused workspace up and opens its canvas entry', async () => {
  const root = makeRoot([])
  const { host, worker } = await boot({ w1: root }, 'w1')
  await worker.command('design.openCanvas')
  assert.ok(existsSync(path.join(root, 'design/canvas.design.json')))
  assert.deepEqual((host.callsOf('editor.open') as any[])[0], { workspaceId: 'w1', path: 'design/canvas.design.json' })
  await worker.deactivate()
})

test('Open canvas in a workspace opened at design/ opens the entry beside it', async () => {
  const root = makeRoot(['minimal'])
  await (await import('./store.ts')).initCanvas(root)
  const { host, worker } = await boot({ wd: path.join(root, 'design') }, 'wd')
  await worker.command('design.openCanvas')
  assert.deepEqual((host.callsOf('editor.open') as any[])[0], { workspaceId: 'wd', path: 'canvas.design.json' })
  await worker.deactivate()
})

test('New design opens the canvas and leaves a note for it to start one', async () => {
  const root = makeRoot([])
  const { host, worker } = await boot({ w1: root }, 'w1')
  await worker.command('design.newDesign')
  assert.equal(host.callsOf('editor.open').length, 1)
  assert.equal(host.data().storage['pendingNew:w1'], true)
  await worker.deactivate()
})

test('the status bar item shows only in workspaces that use the canvas', async () => {
  const plain = makeRoot([])
  const used = makeRoot(['minimal'])
  await (await import('./store.ts')).initCanvas(used)
  const { host, worker } = await boot({ p: plain, u: used }, 'p')
  await worker.emit('workspace.changed', { context: ctx('u') })
  await worker.emit('workspace.changed', { context: ctx('p') })
  const updates = (host.callsOf('statusBar.update') as any[]).map((u) => u.visible)
  // The last update is for the last event, even though an earlier one finished later.
  assert.deepEqual(updates.slice(-2), [true, false])
  await worker.deactivate()
})
