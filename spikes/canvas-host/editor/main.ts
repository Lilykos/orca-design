// Spike: can an Orca editor frame host sandboxed srcdoc artboards fed by the worker?
const log = document.createElement('pre')
log.style.cssText = 'margin:0;padding:8px;font:12px ui-monospace,monospace;color:var(--orca-foreground);background:var(--orca-background);white-space:pre-wrap;max-height:45vh;overflow:auto'
const stage = document.createElement('div')
stage.style.cssText = 'display:flex;gap:12px;padding:8px;align-items:flex-start;background:var(--orca-muted)'
document.body.style.margin = '0'
document.body.append(log, stage)
const results: Record<string, string> = {}
const out = (k: string, v: unknown) => {
  results[k] = typeof v === 'string' ? v : JSON.stringify(v)
  log.textContent = Object.entries(results).map(([a, b]) => `${a}: ${b}`).join('\n')
  ;(window as any).__spike = results
}

window.addEventListener('message', (e) => {
  const d = e.data
  if (d && d.spike) out(`iframe:${d.spike}`, d.value)
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
function testFrame(name: string, html: string, sandbox = 'allow-scripts') {
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', sandbox)
  f.style.cssText = 'width:260px;height:180px;border:1px solid var(--orca-border);background:#fff'
  f.srcdoc = html
  stage.append(f)
  return f
}

out('csp(meta)', document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? 'none')
out('origin', location.origin + ' ' + location.protocol)

testFrame('inline', `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; script-src 'unsafe-inline'; media-src data: blob:">
<style>body{font:14px system-ui;background:#f6f5f1;color:#222} .ok{color:green}</style></head>
<body><h3 class="ok" data-dc-id="title">styled inline</h3><img id="i" src="${PNG}" width="20" height="20"><button id="b" onclick="window.__clicked=1">btn</button>
<script>
const s = (k, v) => parent.postMessage({ spike: k, value: v }, '*');
s('inlineScript', 'ran');
s('inlineStyle', getComputedStyle(document.querySelector('.ok')).color);
const i = document.getElementById('i'); i.complete && i.naturalWidth ? s('dataImg','loaded') : (i.onload=()=>s('dataImg','loaded'), i.onerror=()=>s('dataImg','error'));
document.getElementById('b').click(); s('onclickAttr', window.__clicked ? 'ran' : 'blocked');
document.addEventListener('securitypolicyviolation', e => s('violation', e.violatedDirective + ' ' + e.blockedURI));
</script></body></html>`)

try {
  const ctx = (await orca.host.call('workspace.readContext', {})) as { workspaceId?: string; displayName: string } | null
  out('readContext', ctx ? { id: ctx.workspaceId, name: ctx.displayName } : null)
  const where = (await orca.plugin.request('spike.where', { workspaceId: ctx?.workspaceId })) as { path: string | null; count: number }
  out('workspacePath', where)
  for (const n of [200_000, 900_000, 1_100_000]) {
    try {
      const r = (await orca.plugin.request('spike.big', { bytes: n })) as { text: string }
      out(`big${n}`, `ok ${r.text.length}`)
    } catch (e: any) { out(`big${n}`, `fail ${e?.code} ${e?.message}`) }
  }
  if (where.path) {
    const dir = where.path + '/design'
    const r = (await orca.plugin.request('spike.read', { file: dir + '/spike/a.html' })) as { text: string }
    out('readArtboard', `ok ${r.text.length} chars`)
    const f = testFrame('fromDisk', r.text)
    orca.plugin.on('spike.changed', async (p: any) => {
      out('watch', p); void orca.plugin.request('spike.ack', p)
      const r2 = (await orca.plugin.request('spike.read', { file: dir + '/spike/a.html' })) as { text: string }
      f.srcdoc = r2.text
    })
    out('watchStart', await orca.plugin.request('spike.watch', { dir }))
  }
} catch (e: any) {
  out('error', `${e?.code ?? ''} ${e?.message ?? e}`)
}
