import { assert, test } from 'orca/testing'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { makeRoot } from '../tests/helpers.ts'
import { closeAll, watchRoot } from './watch.ts'

test('watching a folder that does not exist does not throw', () => {
  const stop = watchRoot(path.join(tmpdir(), 'dc-no-such-folder-' + Date.now()), () => {})
  stop()
})

test('a watched workspace that is deleted does not crash the worker', async () => {
  const root = makeRoot(['minimal'])
  const crashes: unknown[] = []
  const onCrash = (error: unknown) => crashes.push(error)
  process.on('uncaughtException', onCrash)
  const stop = watchRoot(root, () => {})
  await new Promise((r) => setTimeout(r, 300))
  rmSync(root, { recursive: true, force: true })
  await new Promise((r) => setTimeout(r, 1200))
  stop()
  closeAll()
  process.off('uncaughtException', onCrash)
  assert.deepEqual(crashes, [])
})
