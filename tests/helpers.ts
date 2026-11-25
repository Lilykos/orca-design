import { cpSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A fresh workspace root whose design/ holds copies of the named fixtures. */
export function makeRoot(fixtures: string[] = ['sample-alternatives', 'minimal']): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dc-test-')))
  mkdirSync(path.join(root, 'design'))
  for (const name of fixtures) cpSync(path.join('tests/fixtures', name), path.join(root, 'design', name), { recursive: true })
  return root
}

/** A mock host answering workspace.list with one workspace per (id → root). */
export function workspaces(map: Record<string, string>) {
  return {
    'workspace.list': {
      workspaces: Object.entries(map).map(([id, root]) => ({
        id, kind: 'worktree', name: path.basename(root), project: 'p', projectId: 'p1', path: root, branch: 'main', hostId: 'local'
      })),
      truncated: false
    }
  }
}
