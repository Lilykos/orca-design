import { assert, afterEach, beforeEach, test } from 'orca/testing'
import { Window } from 'happy-dom'
import { openSendSheet, type SheetOptions } from './send-sheet.ts'
import type { AgentRow } from '../shared/protocol.ts'

// happy-dom stands in for the browser DOM that send-sheet.ts draws into. Its globals are set only
// while these tests run, and the previous values are put back afterwards.
const GLOBALS = ['window', 'document', 'HTMLElement', 'Option', 'Event', 'KeyboardEvent'] as const
const g = globalThis as unknown as Record<string, unknown>
let saved: Record<string, unknown> = {}
let win: Window
let host: HTMLElement

// happy-dom has no Option constructor, and send-sheet.ts builds its <select> with `new Option(...)`:
// this returns the same kind of element.
function FakeOption(text = '', value = '', defaultSelected = false, selected = false) {
  const option = win.document.createElement('option')
  option.text = text
  option.value = value
  option.selected = selected
  return option
}

beforeEach(() => {
  win = new Window()
  saved = Object.fromEntries(GLOBALS.map((name) => [name, g[name]]))
  const fake: Record<string, unknown> = {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    Option: FakeOption,
    Event: win.Event,
    KeyboardEvent: win.KeyboardEvent,
  }
  for (const name of GLOBALS) g[name] = fake[name]
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  host.remove()
  win.close()
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete g[name]
    else g[name] = saved[name]
  }
})

const row = (terminalId: string, sessionId: string, title: string): AgentRow => ({
  terminalId,
  title,
  agent: 'claude',
  state: 'waiting',
  sessionId,
})

const open = (overrides: Partial<SheetOptions>): Promise<boolean> =>
  openSendSheet({ host, text: '', rows: [], preferred: null, onSend: async () => {}, onLaunch: async () => {}, ...overrides })

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')]
const byLabel = (label: string): HTMLButtonElement => buttons().find((b) => b.textContent?.trim() === label)!

test('the sheet shows the exact request text', async () => {
  const text = 'Read design/landing/.requests/2026-11-26T10-00-00-comments.md and do what it asks.\n  <b>kept</b> & "as is"'
  const pending = open({ text, rows: [row('a', 's1', 'Claude')] })
  assert.equal(host.querySelector('pre')?.textContent, text)
  byLabel('Cancel').click()
  assert.equal(await pending, false)
})

test('with two agents and none recorded, Send is disabled until one is chosen', async () => {
  let sent = ''
  const pending = open({
    rows: [row('a', 's1', 'Claude 1'), row('b', 's2', 'Claude 2')],
    preferred: null,
    onSend: async (terminalId) => {
      sent = terminalId
    },
  })
  const select = host.querySelector('select')!
  const send = byLabel('Send')
  assert.equal(select.value, '')
  assert.equal(send.disabled, true)
  select.value = 'b'
  select.dispatchEvent(new Event('change'))
  assert.equal(send.disabled, false)
  send.click()
  assert.equal(await pending, true)
  assert.equal(sent, 'b')
})

test('with no agent, only Start Claude is offered', async () => {
  let launched = ''
  const pending = open({
    rows: [],
    onLaunch: async (agent) => {
      launched = agent
    },
  })
  assert.equal(host.querySelector('select'), null)
  assert.deepEqual(buttons().map((b) => b.textContent?.trim()), ['Cancel', 'Start Claude with this'])
  byLabel('Start Claude with this').click()
  assert.equal(await pending, true)
  assert.equal(launched, 'claude')
})

test('while onSend is pending, Cancel is disabled and Escape does not close the sheet', async () => {
  let finishSend: () => void = () => {}
  let sent = ''
  const pending = open({
    rows: [row('a', 's1', 'Claude')],
    onSend: (terminalId) => {
      sent = terminalId
      return new Promise<void>((resolve) => {
        finishSend = resolve
      })
    },
  })
  byLabel('Send').click()
  assert.equal(sent, 'a')
  assert.equal(byLabel('Cancel').disabled, true)
  host.querySelector('.dc-sheet')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.notEqual(host.querySelector('.dc-sheet-veil'), null)
  finishSend()
  assert.equal(await pending, true)
  assert.equal(host.querySelector('.dc-sheet-veil'), null)
})
