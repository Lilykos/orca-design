import { assert, test } from 'orca/testing'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot } from '../tests/helpers.ts'
import { exportDesign, importDesign } from './store.ts'
import { readZip, writeZip } from './zip.ts'

test('export then import round-trips a design and renames a taken slug', async () => {
  const from = makeRoot(['minimal'])
  const to = makeRoot(['minimal'])
  const { fileName, zip } = await exportDesign(from, 'minimal')
  assert.equal(fileName, 'minimal.zip')
  const result = await importDesign(to, zip)
  assert.equal(result.slug, 'minimal-2')
  assert.equal(
    readFileSync(path.join(to, 'design/minimal-2/a.html'), 'utf8'),
    readFileSync(path.join(from, 'design/minimal/a.html'), 'utf8')
  )
})

test('export leaves out dot-folders such as the request history', async () => {
  const root = makeRoot(['minimal'])
  mkdirSync(path.join(root, 'design/minimal/.requests'))
  writeFileSync(path.join(root, 'design/minimal/.requests/x.md'), 'Fix the title\n')
  const { zip } = await exportDesign(root, 'minimal')
  const names = readZip(zip).map((entry) => entry.name)
  assert.ok(names.includes('minimal/design.json'))
  assert.ok(!names.some((name) => name.split('/').includes('.requests')))
})

test('import refuses an entry that leaves the folder', async () => {
  const to = makeRoot([])
  const zip = writeZip([
    { name: 'x/design.json', data: Buffer.from(readFileSync('tests/fixtures/minimal/design.json')), mtime: Date.now() },
    { name: '../evil', data: Buffer.from('boom'), mtime: Date.now() }
  ])
  await assert.rejects(importDesign(to, zip))
})
