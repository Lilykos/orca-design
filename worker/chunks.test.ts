import { assert, test } from 'orca/testing'
import { CHUNK, sliceChunk, UploadBuffer } from './chunks.ts'

test('sliceChunk reassembles a 2 MB string exactly', () => {
  const text = 'abcdefghij'.repeat(200_000)
  let offset = 0
  let joined = ''
  for (;;) {
    const part = sliceChunk(text, offset)
    assert.ok(part.chunk.length <= CHUNK)
    assert.equal(part.total, text.length)
    joined += part.chunk
    offset = part.offset
    if (part.done) break
  }
  assert.equal(joined, text)
})

test('sliceChunk reassembles emoji exactly and never ends a piece inside a surrogate pair', () => {
  // The odd 'a' moves the pairs to odd offsets, so a plain CHUNK boundary falls between the halves.
  const text = '😀'.repeat(150_000) + 'a' + '🎉'.repeat(150_000)
  let offset = 0
  let joined = ''
  for (;;) {
    const part = sliceChunk(text, offset)
    assert.ok(part.chunk.length <= CHUNK)
    if (!part.done) {
      const last = part.chunk.charCodeAt(part.chunk.length - 1)
      assert.ok(last < 0xd800 || last > 0xdbff, `chunk ends in a high surrogate at ${part.offset}`)
    }
    joined += part.chunk
    offset = part.offset
    if (part.done) break
  }
  assert.equal(joined, text)
})

test('sliceChunk of an empty string is one done chunk', () => {
  assert.deepEqual(sliceChunk('', 0), { chunk: '', offset: 0, total: 0, done: true })
})

test('UploadBuffer joins parts and forgets taken ids', () => {
  const buffers = new UploadBuffer()
  const id = buffers.begin()
  buffers.append(id, 'ab')
  buffers.append(id, 'cd')
  assert.equal(buffers.take(id), 'abcd')
  assert.throws(() => buffers.take(id))
})

test('UploadBuffer refuses an upload past its cap', () => {
  const buffers = new UploadBuffer(10)
  const id = buffers.begin()
  buffers.append(id, '12345')
  assert.throws(() => buffers.append(id, '123456'))
})
