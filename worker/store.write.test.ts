import { assert, test } from 'orca/testing'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot } from '../tests/helpers.ts'
import { addComment, ConflictError, deleteComment, editText, initCanvas, moveElement, readComments, rememberDesignAgent, trashDesign, viewArtboard } from './store.ts'

const anchor = { artboardId: 'a', dcId: 'p', path: 'body > p', tag: 'p', text: 'Hello', html: '<p>', rect: { x: 0, y: 0, width: 1, height: 1 } }
const page = (root: string) => path.join(root, 'design/minimal/a.html')

test('moveElement refuses a stale version', async () => {
  const root = makeRoot(['minimal'])
  const before = readFileSync(page(root), 'utf8')
  await assert.rejects(moveElement(root, 'minimal', 'a', 'p', { translate: '10px 0px' }, 'old'), (e: unknown) => e instanceof ConflictError)
  assert.equal(readFileSync(page(root), 'utf8'), before)
})

test('moveElement writes translate on the named element', async () => {
  const root = makeRoot(['minimal'])
  const { source } = await viewArtboard(root, 'minimal', 'a')
  await moveElement(root, 'minimal', 'a', 'p', { translate: '10px 0px' }, source)
  assert.match(readFileSync(page(root), 'utf8'), /data-dc-id="p" style="translate: 10px 0px;?"/)
})

test('editText keeps entities around the change', async () => {
  const root = makeRoot(['minimal'])
  const { source } = await viewArtboard(root, 'minimal', 'a')
  await editText(root, 'minimal', 'a', { dcId: 'title', path: [], index: 0 }, 'Tom & Jerry', 'Tim & Jerry', source)
  assert.match(readFileSync(page(root), 'utf8'), /Tim &amp; Jerry/)
})

test('comment numbers never repeat', async () => {
  const root = makeRoot(['minimal'])
  const first = await addComment(root, 'minimal', 'one', anchor, 1)
  await deleteComment(root, 'minimal', first.id)
  const second = await addComment(root, 'minimal', 'two', anchor, 2)
  assert.equal(first.number, 1)
  assert.equal(second.number, 2)
  assert.equal((await readComments(root, 'minimal')).comments.length, 1)
})

test('trash moves the design under .trash', async () => {
  const root = makeRoot(['minimal'])
  const { trashedTo } = await trashDesign(root, 'minimal', Date.UTC(2026, 10, 25))
  assert.ok(trashedTo.startsWith('design/.trash/minimal-'))
  assert.equal(existsSync(path.join(root, 'design/minimal')), false)
})

test('initCanvas writes the Orca entry, is idempotent, and keeps a hand-written README', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/README.md'), '# My notes\n')
  assert.equal(await initCanvas(root), true)
  assert.equal(await initCanvas(root), false)
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'design/canvas.design.json'), 'utf8')), { version: 1 })
  assert.equal(readFileSync(path.join(root, 'design/README.md'), 'utf8'), '# My notes\n')
  assert.equal(existsSync(path.join(root, 'design/canvas.json')), false)
})

test('rememberDesignAgent writes canvas.design.json and leaves canvas.json alone', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.json'), '{"version":1}')
  await rememberDesignAgent(root, 'minimal', 'session-1')
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'design/canvas.design.json'), 'utf8')).agents, { minimal: 'session-1' })
  assert.equal(readFileSync(path.join(root, 'design/canvas.json'), 'utf8'), '{"version":1}')
  assert.ok(readdirSync(path.join(root, 'design')).includes('canvas.design.json'))
})
