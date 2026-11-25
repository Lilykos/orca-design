import { assert, test } from 'orca/testing'
import { symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot } from '../tests/helpers.ts'
import { PathError, resolveInside } from './paths.ts'
import { inlineHtml } from './inline.ts'

test('resolveInside refuses .. out of design/', async () => {
  const root = makeRoot(['minimal'])
  const d = path.join(root, 'design')
  await assert.rejects(resolveInside(d, path.join(d, 'minimal'), '../../../etc/passwd'), (e: unknown) => e instanceof PathError)
})

test('inlineHtml refuses a symlink that leads outside design/', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'secret.css'), 'body{color:red}')
  symlinkSync(path.join(root, 'secret.css'), path.join(root, 'design/minimal/evil.css'))
  const html = '<link rel="stylesheet" href="evil.css">'
  const r = await inlineHtml(html, path.join(root, 'design/minimal/a.html'), path.join(root, 'design'))
  assert.ok(!/color:red/.test(r.html))
})
