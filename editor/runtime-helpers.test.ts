import { assert, test } from 'orca/testing'
import { JOIN_TEXTS_SRC, PIN_POSITION_SRC } from './runtime-helpers.ts'

// The helpers run inside the artboard iframe as plain JS source; test that exact source.
const joinTexts = new Function(`${JOIN_TEXTS_SRC}; return joinTexts;`)() as (texts: string[]) => string
const pinPosition = new Function(`${PIN_POSITION_SRC}; return pinPosition;`)() as (
  rect: { x: number; y: number; width: number; height: number }, pageWidth: number, scale: number
) => { x: number; y: number }

test('joinTexts separates the pieces of a card with a middle dot', () => {
  assert.equal(
    joinTexts(['An Ordinary Wonder', ' A COLLECTION', 'IRIS BELL', '\n An Ordinary Wonder ', 'Iris Bell', '  ']),
    'An Ordinary Wonder · A COLLECTION · IRIS BELL · An Ordinary Wonder · Iris Bell'
  )
})

test('joinTexts cuts at 200 characters', () => {
  assert.equal(joinTexts(['x'.repeat(150), 'y'.repeat(150)]).length, 200)
})

test('pinPosition puts a 20 px pin just outside the top-right corner at any zoom', () => {
  const scale = 4 // zoom 0.25: one screen px is four page px
  const p = pinPosition({ x: 100, y: 300, width: 200, height: 50 }, 1440, scale)
  // Pin centre sits half a pin (10 screen px) right of and above the corner.
  assert.deepEqual(p, { x: 300 + 10 * scale, y: 300 - 10 * scale })
})

test('pinPosition stays inside the page', () => {
  const scale = 4
  const p = pinPosition({ x: 1300, y: 0, width: 140, height: 20 }, 1440, scale)
  assert.equal(p.x, 1440 - 10 * scale)
  assert.equal(p.y, 10 * scale)
})
