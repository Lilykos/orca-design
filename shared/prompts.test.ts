import { assert, test } from 'orca/testing'
import { applyTweaksPrompt, commentsPrompt, newDesignPrompt, tweaksPrompt } from './prompts.ts'

const manifest = { version: 1 as const, title: 'Demo', kind: 'other' as const, artboards: [{ id: 'a', title: 'A', file: 'a.html', width: 390 }],
  tweaks: [{ id: 'accent', label: 'Accent', type: 'color' as const, var: '--accent', default: '#000000' }] }
const comment = (n: number) => ({ id: `c-000${n}`, number: n, body: 'Bigger', status: 'pending' as const, createdAt: 1,
  anchor: { artboardId: 'a', dcId: 'title', path: 'h1', tag: 'h1', text: 'T', html: '<h1>', rect: { x: 0, y: 0, width: 1, height: 1 } } })

const all = () => [
  commentsPrompt('demo', manifest, [comment(1)]),
  commentsPrompt('demo', manifest, [comment(1), comment(2)]),
  newDesignPrompt('A pricing page', 'wireframe'),
  tweaksPrompt('demo', manifest),
  applyTweaksPrompt('demo', manifest, { accent: '#ff0000' })
]

test('prompts point agents at the CLI, never at Paseo tools', () => {
  for (const p of all()) {
    assert.ok(!/design_(create|list|read|resolve_comments|set_tweaks)/.test(p), p)
    assert.match(p, /node design\/\.canvas\/dc\.mjs/)
  }
})

test('prompts send agents to the Orca guide', () => {
  assert.match(newDesignPrompt('x'), /design\/\.canvas\/GUIDE\.md/)
})

test('one comment reads "this comment"', () => {
  assert.match(commentsPrompt('demo', manifest, [comment(1)]), /for this comment from/)
  assert.match(commentsPrompt('demo', manifest, [comment(1), comment(2)]), /for these 2 comments from/)
})

test('the comments prompt shows the exact resolve command', () => {
  assert.match(commentsPrompt('demo', manifest, [comment(1), comment(2)]), /node design\/\.canvas\/dc\.mjs resolve demo 1 "<what you changed>" 2 "<what you changed>"/)
})
