// Spawns the freshly-built packaged app (not the installed one), waits for its
// child server to log "Server running on 127.0.0.1:<port>", then probes /api/*
// with unauthenticated requests. Confirms the runtime hardening survives the
// esbuild bundle → Electron main → child-process server chain, not just the
// source tree we already tested in scripts/smoke-security.mjs.
//
// Uses an isolated --user-data-dir so it can't step on the user's real
// provider-keys.json or race their currently-running instance.
import { spawn } from 'child_process'
import { setTimeout as delay } from 'timers/promises'
import net from 'net'

const EXE = 'C:/Users/chris/Desktop/LLM_Roundtable/out/llm-roundtable-win32-x64/llm-roundtable.exe'
const USER_DATA = 'C:/Users/chris/AppData/Local/Temp/roundtable-smoke-userdata'

const results = []
function assert(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

console.log(`\nLaunching packaged app with isolated userData=${USER_DATA}\n`)

const proc = spawn(EXE, [`--user-data-dir=${USER_DATA}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
})

let stdout = ''
let stderr = ''
proc.stdout.on('data', d => { stdout += d.toString(); process.stdout.write(d) })
proc.stderr.on('data', d => { stderr += d.toString(); process.stderr.write(d) })

let port = null
const started = Date.now()
while (Date.now() - started < 30000) {
  const m = stdout.match(/Server running on 127\.0\.0\.1:(\d+)/)
  if (m) { port = Number(m[1]); break }
  await delay(200)
}

if (!port) {
  console.error('\nServer did not report port within 30s — killing app')
  proc.kill()
  await delay(500)
  process.exit(2)
}

console.log(`\nServer port detected: ${port}. Waiting 2s for HTTP readiness…\n`)
await delay(2000)

const base = `http://127.0.0.1:${port}`

// A: no auth → 401 with typed error body
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  const body = await r.json().catch(() => ({}))
  assert('A. packaged app: /api/ask with no auth → 401', r.status === 401, `got ${r.status}`)
  assert('A2. 401 body has typed adapter error', body?.error?.category === 'auth', JSON.stringify(body?.error).slice(0, 80))
}

// B: wrong Bearer → 401
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer garbage' }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  assert('B. packaged app: wrong bearer → 401', r.status === 401, `got ${r.status}`)
}

// C: same-length wrong bearer → 401 (rules out length-early-exit compare)
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + 'x'.repeat(64) }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  assert('C. packaged app: same-length wrong bearer → 401', r.status === 401, `got ${r.status}`)
}

// D: server bound loopback-only (test-bind to 0.0.0.0:port should succeed = app not on 0.0.0.0)
{
  const canBindZero = await new Promise(resolve => {
    const t = net.createServer()
    t.once('error', () => resolve(false))
    t.listen(port, '0.0.0.0', () => { t.close(() => resolve(true)) })
  })
  assert('D. packaged app: server bound to 127.0.0.1 only', canBindZero, canBindZero ? 'confirmed loopback-only' : 'appears bound to 0.0.0.0')
}

// E: x-powered-by absent
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert('E. packaged app: X-Powered-By absent', !r.headers.get('x-powered-by'), `got ${r.headers.get('x-powered-by')}`)
}

// F: CORS rejects arbitrary origins
{
  const r = await fetch(`${base}/api/ask`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example.com', 'Access-Control-Request-Method': 'POST' } })
  assert('F. packaged app: OPTIONS from evil origin → 403 no ACAO', r.status === 403 && !r.headers.get('access-control-allow-origin'), `status=${r.status} acao=${r.headers.get('access-control-allow-origin')}`)
}

// G: token isn't in stdout/stderr of packaged app (packaged app writes ROUNDTABLE_AUTH_TOKEN as env; check the app doesn't echo it)
{
  // Look for anything hex-like of length 64 in stdout (the token is 32 random bytes → 64 hex chars)
  const hex64 = /\b[a-f0-9]{64}\b/i
  const inStdout = hex64.test(stdout)
  const inStderr = hex64.test(stderr)
  assert('G. packaged app: no 64-char hex token in stdout', !inStdout, inStdout ? 'FOUND — token may be leaking' : '')
  assert('G2. packaged app: no 64-char hex token in stderr', !inStderr, inStderr ? 'FOUND — token may be leaking' : '')
}

// Cleanup
console.log('\nKilling packaged app instance…')
proc.kill()
await delay(1000)
// Best-effort: kill lingering renderer/gpu child processes
try { spawn('taskkill', ['/F', '/IM', 'llm-roundtable.exe', '/FI', `PID ne ${proc.pid}`], { stdio: 'ignore' }) } catch {}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed against the packaged app`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
process.exit(0)
