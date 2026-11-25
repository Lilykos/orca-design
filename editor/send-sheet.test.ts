import { assert, test } from 'orca/testing'
import { sheetModel } from './send-sheet.ts'
import type { AgentRow } from '../shared/protocol.ts'

const row = (terminalId: string, sessionId: string, title = 'Claude'): AgentRow => ({ terminalId, title, agent: 'claude', state: 'waiting', sessionId })

test('with no agent the sheet offers Launch and no Send', () => {
  const m = sheetModel([], null)
  assert.equal(m.canSend, false)
  assert.equal(m.offerLaunch, true)
  assert.deepEqual(m.options, [])
})

test('the recorded session is preselected among several agents', () => {
  const m = sheetModel([row('a', 's1'), row('b', 's2')], 'claude:s2')
  assert.equal(m.selected, 'b')
  assert.equal(m.canSend, true)
})

test('with several agents and no record, nothing is preselected', () => {
  const m = sheetModel([row('a', 's1'), row('b', 's2')], null)
  assert.equal(m.selected, null)
  assert.equal(m.canSend, false)
  assert.equal(m.options.length, 2)
})

test('a lone agent is preselected', () => {
  assert.equal(sheetModel([row('a', 's1')], null).selected, 'a')
})
