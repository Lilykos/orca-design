import type { OrcaWorkerApi } from 'orca/worker'
import { readFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

let watcher: FSWatcher | null = null

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('spike.where', async (input) => {
    const { workspaceId } = (input ?? {}) as { workspaceId?: string }
    const { workspaces } = (await orca.host.call('workspace.list', {})) as {
      workspaces: { id: string; path: string; name: string }[]
    }
    const ws = workspaces.find((w) => w.id === workspaceId)
    return { path: ws?.path ?? null, count: workspaces.length }
  })

  orca.panels.handle('spike.read', async (input) => {
    const { file } = input as { file: string }
    return { text: await readFile(file, 'utf8') }
  })

  orca.panels.handle('spike.ack', async (input) => { orca.log(`editor got ${JSON.stringify(input)}`); return { ok: true } })

  orca.panels.handle('spike.big', async (input) => {
    const { bytes } = input as { bytes: number }
    return { text: 'x'.repeat(bytes) }
  })

  orca.panels.handle('spike.watch', async (input, ctx) => {
    const { dir } = input as { dir: string }
    watcher?.close()
    watcher = watch(dir, { recursive: true }, (_ev, name) => {
      orca.log(`watch ${String(name)}`); orca.panels.post('spike.changed', { name: String(name), at: Date.now() })
    })
    return { ok: true, panel: ctx.panel ?? null }
  })
}

export function deactivate(): void {
  watcher?.close()
}
