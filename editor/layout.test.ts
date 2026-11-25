import { assert, test } from 'orca/testing'
import { COLUMN_GAP, fitLabel, keepCenter, labelSpaceFor, layoutBoards, maxRowWidth, type BoardSize } from './layout.ts'

const boards = (n: number, width: number, group?: string, prefix = 'b'): BoardSize[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, width, height: 900, ...(group ? { group } : {}) }))

function rowsOf(placed: { y: number; x: number; width: number }[]) {
  const rows = new Map<number, { x: number; width: number }[]>()
  for (const p of placed) rows.set(p.y, [...(rows.get(p.y) ?? []), p])
  return [...rows.values()]
}

test('19 wide artboards in one group wrap into rows no wider than the limit', () => {
  const input = boards(19, 1440, 'Identity')
  const placed = layoutBoards(input)
  const limit = maxRowWidth(input)
  const rows = rowsOf(placed)
  assert.ok(rows.length >= 5, `rows: ${rows.length}`)
  for (const row of rows) {
    const right = Math.max(...row.map((b) => b.x + b.width))
    assert.ok(right <= limit, `row width ${right} > ${limit}`)
  }
  assert.equal(rows[0]!.length, 3)
})

test('two small groups share one row', () => {
  const placed = layoutBoards([...boards(3, 390, 'Mac', 'm'), ...boards(3, 390, 'iPhone', 'i')])
  assert.equal(rowsOf(placed).length, 1)
})

test('a group that does not fit beside the previous one starts a new row', () => {
  const placed = layoutBoards([...boards(2, 1440, 'Mac', 'm'), ...boards(3, 1440, 'Wide', 'w')])
  assert.equal(rowsOf(placed).length, 2)
})

test('dragged boards keep their spot', () => {
  const placed = layoutBoards([{ id: 'p', width: 390, height: 800, x: 5000, y: 7000 }, ...boards(1, 390)])
  assert.deepEqual(placed.find((b) => b.id === 'p'), { id: 'p', x: 5000, y: 7000, width: 390, height: 800 })
})

const mono = (s: string) => s.length * 7

test('fitLabel drops the group, then the size, then ellipsizes the title', () => {
  const parts = { title: '01 · Reading Desk · iPhone', size: '390 × 844', group: 'iPhone companions' }
  assert.deepEqual(fitLabel(parts, 1000, mono), { title: parts.title, size: true, group: true })
  const noGroup = fitLabel(parts, mono(parts.title) + 8 + mono(parts.size) + 2, mono)
  assert.deepEqual(noGroup, { title: parts.title, size: true, group: false })
  const titleOnly = fitLabel(parts, mono(parts.title) + 2, mono)
  assert.deepEqual(titleOnly, { title: parts.title, size: false, group: false })
  const cut = fitLabel(parts, 97, mono)
  assert.equal(cut.size, false)
  assert.ok(mono(cut.title) <= 97, cut.title)
  assert.ok(cut.title.startsWith('01 · Rea') && cut.title.endsWith('…'), cut.title)
})

test('keepCenter keeps zoom and the point at the centre when the viewport resizes', () => {
  const view = { x: 100, y: 50, zoom: 0.25 }
  const next = keepCenter(view, { width: 1400, height: 900 }, { width: 1100, height: 900 })
  assert.equal(next.zoom, 0.25)
  // The world point under the old centre is under the new centre.
  const worldX = (700 - view.x) / view.zoom
  assert.equal(next.x + worldX * next.zoom, 550)
  assert.equal(next.y, 50)
})

void COLUMN_GAP

test('rows leave the asked label space above each row', () => {
  const input = boards(4, 1440, 'Identity')
  const tight = rowsOf(layoutBoards(input, 4600, 32))
  const roomy = rowsOf(layoutBoards(input, 4600, 300))
  assert.equal(tight.length, 2)
  const gapOf = (rows: ReturnType<typeof rowsOf>, placed: ReturnType<typeof layoutBoards>) => {
    const ys = [...new Set(placed.map((p) => p.y))].sort((a, b) => a - b)
    return ys[1]! - ys[0]!
  }
  assert.equal(gapOf(roomy, layoutBoards(input, 4600, 300)) - gapOf(tight, layoutBoards(input, 4600, 32)), 268)
})

test('labelSpaceFor keeps a label readable on screen at any zoom', () => {
  assert.equal(labelSpaceFor(1), 32)
  assert.ok(labelSpaceFor(0.08) * 0.08 >= 24)
})

test('with a viewport aspect, rows widen to match the viewport shape', () => {
  const input = boards(19, 1440, 'Identity').map((b) => ({ ...b, height: 1100 }))
  const wide = rowsOf(layoutBoards(input, maxRowWidth(input, 1.6)))
  assert.equal(wide[0]!.length, 6)
  // Never narrower than the default.
  assert.ok(maxRowWidth(input, 0.2) >= maxRowWidth(input))
})
