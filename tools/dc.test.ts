import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot } from '../tests/helpers.ts'

const CLI = path.resolve('assets/dc.mjs')

function dc(root: string, args: string[]): { code: number; out: any } {
  try {
    const text = execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' })
    return { code: 0, out: JSON.parse(text) }
  } catch (error: any) {
    return { code: error.status, out: error.stdout ? JSON.parse(error.stdout) : null }
  }
}

test('create makes a valid design with placeholder pages', () => {
  const root = makeRoot([])
  const spec = { title: 'Demo', kind: 'wireframe', artboards: [{ id: 'home', title: 'Home', width: 390, height: 844 }] }
  const r = dc(root, ['create', 'demo', JSON.stringify(spec)])
  assert.equal(r.code, 0)
  const manifest = JSON.parse(readFileSync(path.join(root, 'design/demo/design.json'), 'utf8'))
  assert.equal(manifest.artboards[0].file, 'home.html')
  assert.match(readFileSync(path.join(root, 'design/demo/home.html'), 'utf8'), /data-dc-id=/)
  assert.ok(existsSync(path.join(root, 'design/canvas.design.json')))
})

test('create refuses a taken slug', () => {
  const root = makeRoot(['minimal'])
  const r = dc(root, ['create', 'minimal', JSON.stringify({ title: 'x', kind: 'other', artboards: [{ id: 'a', title: 'A', width: 390 }] })])
  assert.equal(r.code, 2)
})

test('resolve marks a comment resolved with its note', () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/minimal/comments.json'), JSON.stringify({
    version: 1, nextNumber: 2,
    comments: [{ id: 'c-abcd', number: 1, body: 'Bigger', status: 'sent', createdAt: 1,
      anchor: { artboardId: 'a', dcId: 'title', path: 'h1', tag: 'h1', text: 'T', html: '<h1>', rect: { x: 0, y: 0, width: 1, height: 1 } } }]
  }))
  const r = dc(root, ['resolve', 'minimal', '1', 'Made the title 40px'])
  assert.equal(r.code, 0)
  const c = JSON.parse(readFileSync(path.join(root, 'design/minimal/comments.json'), 'utf8')).comments[0]
  assert.equal(c.status, 'resolved')
  assert.equal(c.resolution, 'Made the title 40px')
})

test('validate names a duplicate artboard id and exits 2', () => {
  const root = makeRoot(['minimal'])
  const file = path.join(root, 'design/minimal/design.json')
  const m = JSON.parse(readFileSync(file, 'utf8'))
  m.artboards.push({ ...m.artboards[0], file: 'b.html' })
  writeFileSync(file, JSON.stringify(m))
  const r = dc(root, ['validate'])
  assert.equal(r.code, 2)
  assert.match(JSON.stringify(r.out), /Duplicate artboard id a/)
})

test('validate passes the real folio design', () => {
  const root = makeRoot(['folio-app-alternatives'])
  assert.equal(dc(root, ['validate']).code, 0)
})

test('list and read work from a subfolder of the workspace', () => {
  const root = makeRoot(['minimal'])
  const r = dc(path.join(root, 'design/minimal'), ['list'])
  assert.equal(r.code, 0)
  assert.equal(r.out.designs[0].slug, 'minimal')
  assert.equal(dc(root, ['read', 'minimal']).out.manifest.title, 'Minimal')
})

test('unknown command is a usage error', () => {
  assert.equal(dc(makeRoot([]), ['frobnicate']).code, 1)
})
