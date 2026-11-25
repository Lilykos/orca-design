import { assert, test } from 'orca/testing'
import { resetWorkspaceCache, resolveRoot, type HostCaller } from './workspace.ts'
import { workspaces } from '../tests/helpers.ts'

const fake = (results: Record<string, unknown>): HostCaller => ({ call: async (m: string) => results[m] as never })

test('resolveRoot maps a workspace id to its path', async () => {
  assert.equal(await resolveRoot(fake(workspaces({ w1: '/tmp/ws1' })), 'w1'), '/tmp/ws1')
})

resetWorkspaceCache()
test('resolveRoot rejects an unknown id with invalid_params', async () => {
  await assert.rejects(resolveRoot(fake(workspaces({ w1: '/tmp/ws1' })), 'nope'), (e: any) => e.code === 'invalid_params')
})
