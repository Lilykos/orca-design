import { assert, test } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { manifestSchema, CANVAS_ENTRY, REQUESTS_DIR, CLI_FILE } from './design.ts'

const board = (id: string) => ({ id, title: id, file: `${id}.html`, width: 390 })

test('parses the real folio manifest', () => {
  const m = manifestSchema.parse(JSON.parse(readFileSync('tests/fixtures/folio-app-alternatives/design.json', 'utf8')))
  assert.equal(m.artboards.length, 6)
})

test('rejects duplicate artboard ids', () => {
  const r = manifestSchema.safeParse({ version: 1, title: 't', kind: 'other', artboards: [board('x'), { ...board('x'), file: 'y.html' }] })
  assert.equal(r.success, false)
})

test('names the Orca-specific files', () => {
  assert.equal(CANVAS_ENTRY, 'canvas.design.json')
  assert.equal(REQUESTS_DIR, '.requests')
  assert.equal(CLI_FILE, '.canvas/dc.mjs')
})
