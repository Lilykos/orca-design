import { assert, hostError, mockHost, mountWorker, test } from 'orca/testing'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { makeRoot, workspaces } from '../tests/helpers.ts'
import * as main from './index.ts'
import { pickTarget, pointerLine, writeRequest } from './agents.ts'
import { resetWorkspaceCache } from './workspace.ts'
import type { AgentRow } from '../shared/protocol.ts'

const row = (over: Partial<AgentRow>): AgentRow => ({ terminalId: 't1', title: 'Claude', agent: 'claude', state: 'waiting', sessionId: 's1', ...over })
const listed = (rows: AgentRow[]) => ({ agents: rows.map((r) => ({ ...r, stateStartedAt: 0 })) })

test('pickTarget never chooses a shell terminal', () => {
  assert.deepEqual(pickTarget([row({ agent: null }), row({ terminalId: null })], null), { kind: 'none' })
})

test('pickTarget prefers the recorded session over other agents', () => {
  const a = row({ terminalId: 'ta', sessionId: 'sa' })
  const b = row({ terminalId: 'tb', sessionId: 'sb' })
  assert.deepEqual(pickTarget([a, b], 'claude:sb'), { kind: 'one', row: b })
})

test('pickTarget picks a lone agent and asks when there are several', () => {
  const a = row({ terminalId: 'ta' })
  assert.deepEqual(pickTarget([a], null), { kind: 'one', row: a })
  assert.equal(pickTarget([a, row({ terminalId: 'tb' })], null).kind, 'choose')
})

test('writeRequest keeps the text exactly and returns a workspace-relative path', async () => {
  const root = makeRoot(['minimal'])
  const rel = await writeRequest(root, 'minimal', 'comments', 'Line one\nLine two', Date.UTC(2026, 10, 25, 9, 8, 7))
  assert.equal(rel, 'design/minimal/.requests/20261125-090807-comments.md')
  assert.equal(readFileSync(path.join(root, rel), 'utf8'), 'Line one\nLine two\n')
  assert.equal(pointerLine(rel), 'Read design/minimal/.requests/20261125-090807-comments.md and do what it asks.')
})

async function boot(root: string, results: Record<string, unknown>) {
  resetWorkspaceCache()
  const host = mockHost({ results: { ...workspaces({ w1: root }), 'terminal.sendText': { accepted: true }, ...results } })
  return { host, worker: await mountWorker(main, { host }) }
}

test('dc.send types one pointer line into the only agent', async () => {
  const root = makeRoot(['minimal'])
  const { host, worker } = await boot(root, { 'agents.list': listed([row({ terminalId: 'term-9' })]) })
  const out = await worker.request('dc.send', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'Fix the title' })
  assert.equal(out.terminalId, 'term-9')
  const sent = host.callsOf('terminal.sendText') as any[]
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], { terminalId: 'term-9', text: pointerLine(out.request), enter: true })
  assert.equal(readFileSync(path.join(root, out.request), 'utf8'), 'Fix the title\n')
  await worker.deactivate()
})

test('dc.send with several agents and no choice asks to choose', async () => {
  const { worker } = await boot(makeRoot(['minimal']), { 'agents.list': listed([row({ terminalId: 'a' }), row({ terminalId: 'b' })]) })
  await assert.rejects(
    worker.request('dc.send', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x' }),
    (e: any) => e.code === 'invalid_params' && /choose-agent/.test(e.message)
  )
  await worker.deactivate()
})

test('dc.send with no agent says so and types nothing', async () => {
  const { host, worker } = await boot(makeRoot(['minimal']), { 'agents.list': listed([]) })
  await assert.rejects(worker.request('dc.send', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x' }), (e: any) => /no-agent/.test(e.message))
  assert.equal(host.callsOf('terminal.sendText').length, 0)
  await worker.deactivate()
})

test('dc.send resumes the recorded session when it is not running', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.design.json'), JSON.stringify({ version: 1, agents: { minimal: 'claude:s-old' } }))
  let resumed = false
  const { host, worker } = await boot(root, {
    'agents.list': () => listed(resumed ? [row({ terminalId: 'term-r', sessionId: 's-old' })] : [row({ terminalId: 'other', sessionId: 'x' })]),
    'agent.resume': () => { resumed = true; return { terminalId: 'term-r', started: true } }
  })
  const out = await worker.request('dc.send', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x' })
  assert.equal(out.terminalId, 'term-r')
  assert.deepEqual((host.callsOf('agent.resume') as any[])[0], { workspaceId: 'w1', agent: 'claude', sessionId: 's-old' })
  await worker.deactivate()
})

test('dc.start launches an agent with a pointer to the brief', async () => {
  const root = makeRoot([])
  let launched = false
  const { host, worker } = await boot(root, {
    'agents.list': () => listed(launched ? [row({ terminalId: 'new-t' })] : []),
    'agent.launch': () => { launched = true; return { terminalId: 'new-t' } }
  })
  const out = await worker.request('dc.start', { ws: 'w1', brief: 'A pricing page', kind: 'wireframe', agent: 'claude' })
  assert.equal(out.terminalId, 'new-t')
  const launch = (host.callsOf('agent.launch') as any[])[0]
  assert.equal(launch.agent, 'claude')
  assert.equal(launch.prompt, undefined)
  const typed = (host.callsOf('terminal.sendText') as any[])[0]
  assert.match(typed.text, /^Read design\/\.requests\/\d{8}-\d{6}-new\.md and do what it asks\.$/)
  const file = typed.text.slice(5, typed.text.indexOf(' and do'))
  assert.match(readFileSync(path.join(root, file), 'utf8'), /A pricing page/)
  await worker.deactivate()
})

test('dc.send without a design writes under design/.requests', async () => {
  const root = makeRoot([])
  const { worker } = await boot(root, { 'agents.list': listed([row({ terminalId: 'term-1' })]) })
  const out = await worker.request('dc.send', { ws: 'w1', kind: 'new', text: 'A brief' })
  assert.match(out.request, /^design\/\.requests\/\d{8}-\d{6}-new\.md$/)
  await worker.deactivate()
})

test('dc.launch starts an agent on a design request and records its session for the design', async () => {
  const root = makeRoot(['minimal'])
  let launched = false
  const { host, worker } = await boot(root, {
    'agents.list': () => listed(launched ? [row({ terminalId: 'L1', sessionId: 'sess-L' })] : []),
    'agent.launch': () => { launched = true; return { terminalId: 'L1' } }
  })
  const out = await worker.request('dc.launch', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'Fix it', agent: 'claude' })
  assert.equal(out.terminalId, 'L1')
  // Orca's own launch-prompt delivery races the agent's start-up, so the prompt is typed once
  // the agent is listed, as dc.send does.
  assert.equal((host.callsOf('agent.launch') as any[])[0].prompt, undefined)
  const typed = host.callsOf('terminal.sendText') as any[]
  assert.equal(typed.length, 1)
  assert.match(typed[0].text, /^Read design\/minimal\/\.requests\/.+-comments\.md and do what it asks\.$/)
  assert.equal(typed[0].terminalId, 'L1')
  const end = Date.now() + 3000
  let agents: Record<string, string> = {}
  while (Date.now() < end) {
    try { agents = JSON.parse(readFileSync(path.join(root, 'design/canvas.design.json'), 'utf8')).agents ?? {} } catch {}
    if (agents.minimal) break
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.equal(agents.minimal, 'claude:sess-L')
  await worker.deactivate()
})

test('dc.launch retries typing while the new agent still refuses input', async () => {
  const root = makeRoot(['minimal'])
  let launched = false
  let tries = 0
  const { host, worker } = await boot(root, {
    'agents.list': () => listed(launched ? [row({ terminalId: 'L2', sessionId: 's2' })] : []),
    'agent.launch': () => { launched = true; return { terminalId: 'L2' } },
    'terminal.sendText': () => { tries++; if (tries < 3) throw hostError('consent_required', 'plugin is not enabled with current consent'); return { accepted: true } }
  })
  const out = await worker.request('dc.launch', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x', agent: 'claude' })
  assert.equal(out.terminalId, 'L2')
  assert.equal(tries, 3)
  assert.equal(host.callsOf('agent.launch').length, 1)
  await worker.deactivate()
})

test('dc.launch records the session once Orca reports it, after the launch returns', async () => {
  const root = makeRoot(['minimal'])
  let launched = false
  let listings = 0
  const { worker } = await boot(root, {
    'agents.list': () => {
      if (!launched) return listed([])
      listings++
      return listed([row({ terminalId: 'L3', sessionId: listings < 4 ? null as any : 'late-session' })])
    },
    'agent.launch': () => { launched = true; return { terminalId: 'L3' } }
  })
  await worker.request('dc.launch', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x', agent: 'claude' })
  const end = Date.now() + 8000
  let agents: Record<string, string> = {}
  while (Date.now() < end && !agents.minimal) {
    try { agents = JSON.parse(readFileSync(path.join(root, 'design/canvas.design.json'), 'utf8')).agents ?? {} } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(agents.minimal, 'claude:late-session')
  await worker.deactivate()
})

test('in a workspace opened at design/, the pointer and CLI are relative to design/', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.design.json'), '{"version":1,"id":"x"}')
  resetWorkspaceCache()
  const host = mockHost({ results: { ...workspaces({ wd: path.join(root, 'design') }), 'terminal.sendText': { accepted: true }, 'agents.list': listed([row({ terminalId: 'T' })]) } })
  const worker = await mountWorker(main, { host })
  const out = await worker.request('dc.send', { ws: 'wd', slug: 'minimal', kind: 'comments', text: 'Then run: node design/.canvas/dc.mjs resolve minimal 1 "<what you changed>"' })
  const typed = (host.callsOf('terminal.sendText') as any[])[0].text
  assert.match(typed, /^Read minimal\/\.requests\/.+-comments\.md and do what it asks\.$/)
  assert.match(readFileSync(path.join(root, out.request), 'utf8'), /node \.canvas\/dc\.mjs resolve minimal 1/)
  await worker.deactivate()
})

test('a resumed session gets its pointer only once it accepts input', async () => {
  const root = makeRoot(['minimal'])
  writeFileSync(path.join(root, 'design/canvas.design.json'), JSON.stringify({ version: 1, agents: { minimal: 'claude:s-old' } }))
  let resumed = false
  let tries = 0
  const { worker } = await boot(root, {
    'agents.list': () => listed(resumed ? [row({ terminalId: 'R', sessionId: 's-old' })] : []),
    'agent.resume': () => { resumed = true; return { terminalId: 'R', started: true } },
    'terminal.sendText': () => { tries++; if (tries < 2) throw hostError('consent_required', 'not yet'); return { accepted: true } }
  })
  const out = await worker.request('dc.send', { ws: 'w1', slug: 'minimal', kind: 'comments', text: 'x' })
  assert.equal(out.terminalId, 'R')
  assert.equal(tries, 2)
  await worker.deactivate()
})
