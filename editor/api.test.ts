import { assert, test } from 'orca/testing'
import { createApi, type Requester } from './api.ts'
import { CHUNK } from '../shared/protocol.ts'

const meta = {
  slug: 'x', manifest: null, error: null, comments: [], tweakValues: {}, version: 'v',
  artboards: [{ id: 'a', title: 'A', file: 'a.html', width: 390, html: null, error: null, version: '1', source: 's' }]
}

test('getDesign assembles each page from chunks', async () => {
  const page = 'p'.repeat(CHUNK * 2 + 10)
  const offsets: number[] = []
  const request: Requester = async (name, input: any) => {
    if (name === 'dc.design') return meta
    if (name === 'dc.artboard') {
      offsets.push(input.offset)
      const end = Math.min(page.length, input.offset + CHUNK)
      return { chunk: page.slice(input.offset, end), offset: end, total: page.length, done: end >= page.length, version: '1', source: 's', error: null }
    }
    throw new Error(`unexpected ${name}`)
  }
  const view = await createApi('w1', request).getDesign('x')
  assert.equal(view.artboards[0]!.html, page)
  assert.deepEqual(offsets, [0, CHUNK, 2 * CHUNK])
})

test('a page error comes through with no html', async () => {
  const request: Requester = async (name) =>
    name === 'dc.design' ? meta : { chunk: '', offset: 0, total: 0, done: true, version: 'missing', source: 'missing', error: 'a.html is missing' }
  const view = await createApi('w1', request).getDesign('x')
  assert.equal(view.artboards[0]!.html, null)
  assert.equal(view.artboards[0]!.error, 'a.html is missing')
})

test('every call names the workspace', async () => {
  const seen: any[] = []
  const request: Requester = async (name, input) => { seen.push([name, input]); return { comment: { id: 'c-1' } } }
  await createApi('w9', request).addComment('x', 'hi', {} as any)
  assert.deepEqual(seen[0], ['dc.comment.add', { ws: 'w9', slug: 'x', body: 'hi', anchor: {} }])
})

test('sendToAgent asks the sheet first and sends nothing when cancelled', async () => {
  const seen: string[] = []
  const request: Requester = async (name) => { seen.push(name); return {} }
  const asked: any[] = []
  const api = createApi('w1', request, { currentSlug: () => 'x', confirm: async (req) => { asked.push(req); return false } })
  await assert.rejects(api.sendToAgent('Fix', 'comments'), (e: any) => e.cancelled === true)
  assert.deepEqual(asked, [{ text: 'Fix', kind: 'comments', slug: 'x' }])
  assert.deepEqual(seen, [])
})

test('startDesign hands the sheet the brief, with no design slug', async () => {
  const asked: any[] = []
  const api = createApi('w1', async () => ({}), { currentSlug: () => 'x', confirm: async (req) => { asked.push(req); return true } })
  await api.startDesign('A pricing page')
  assert.equal(asked[0].slug, null)
  assert.equal(asked[0].kind, 'new')
  assert.equal(asked[0].brief, 'A pricing page')
  assert.match(asked[0].text, /A pricing page/)
})

test('a page that changes mid-load is fetched again, never mixed', async () => {
  let loads = 0
  const request: Requester = async (name, input: any) => {
    if (name === 'dc.design') return meta
    if (input.offset === 0) loads++
    // First load: chunk 0 is v1, chunk 1 is v2 (the agent wrote in between). Second load: all v2.
    const version = loads === 1 && input.offset === 0 ? 'v1' : 'v2'
    const text = `${version}-${input.offset === 0 ? 'a' : 'b'}`
    return { chunk: text, offset: input.offset + 1, total: 2, done: input.offset === 1, version, source: version, error: null }
  }
  const view = await createApi('w1', request).getDesign('x')
  assert.equal(view.artboards[0]!.html, 'v2-av2-b')
  assert.equal(view.artboards[0]!.version, 'v2')
})
