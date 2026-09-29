// Headless security-boundary smoke test for the runtime hardening in
// server/src/index.ts. Spawns the server via tsx (same code path Electron
// uses to bundle it, minus the bundler), hits it with fetch, asserts on the
// auth, CORS, binding, and body-size invariants. Prints a pass/fail summary
// and exits non-zero on any failure.
import { spawn } from 'child_process'
import { setTimeout as delay } from 'timers/promises'
import net from 'net'

const TOKEN = 'test-token-' + Math.random().toString(36).slice(2, 14)

function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)) })
    srv.on('error', reject)
  })
}

async function waitFor(cond, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await cond()) return true
    await delay(100)
  }
  return false
}

const results = []
function assert(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const port = await pickPort()
console.log(`\nSpawning server on 127.0.0.1:${port} with token prefix ${TOKEN.slice(0, 12)}…\n`)

const proc = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: 'server',
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    ROUNDTABLE_AUTH_TOKEN: TOKEN,
    // No provider keys — /api/ask will 500 or similar past auth, but auth
    // check runs first and that's what we're measuring.
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
})

let stdoutBuf = ''
let stderrBuf = ''
proc.stdout.on('data', d => { stdoutBuf += d.toString() })
proc.stderr.on('data', d => { stderrBuf += d.toString() })

const ready = await waitFor(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
    return r.status < 600
  } catch { return false }
}, 15000)

if (!ready) {
  console.error('Server did not start within 15s')
  console.error('stdout:', stdoutBuf)
  console.error('stderr:', stderrBuf)
  proc.kill()
  process.exit(2)
}

const base = `http://127.0.0.1:${port}`

// Test A: /api/ask with no Authorization → 401
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  const body = await r.json().catch(() => ({}))
  assert('A. /api/ask with no auth returns 401', r.status === 401, `got ${r.status} ${JSON.stringify(body).slice(0, 80)}`)
  assert('A2. 401 body has typed adapter error', body?.error?.category === 'auth', JSON.stringify(body?.error))
}

// Test B: /api/ask with wrong Bearer → 401
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-the-token' }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  assert('B. /api/ask with wrong token returns 401', r.status === 401, `got ${r.status}`)
}

// Test B2: length-matched wrong bearer (guards against short-circuit compare)
{
  const wrongSameLength = 'x'.repeat(TOKEN.length)
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wrongSameLength}` }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  assert('B2. /api/ask with length-matched wrong token returns 401', r.status === 401, `got ${r.status}`)
}

// Test C: /api/ask with correct Bearer → passes auth (any non-401 is proof)
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  assert('C. /api/ask with correct token passes auth (not 401)', r.status !== 401, `got ${r.status} (expected 500 or similar since no provider key)`)
}

// Test D: 200KB body with correct auth → not 413 (body-parser >100KB works)
{
  const big = 'x'.repeat(200 * 1024)
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ provider: 'openai', prompt: big }) })
  assert('D. 200KB body accepted (>100KB default)', r.status !== 413, `got ${r.status}`)
}

// Test E: server only bound to 127.0.0.1 (attempt to reach via 0.0.0.0 fails or wraps to 127)
// We test by binding a local server to 0.0.0.0:port — if it succeeds, the app is NOT holding 0.0.0.0.
{
  const canBindZero = await new Promise(resolve => {
    const t = net.createServer()
    t.once('error', () => resolve(false))
    t.listen(port, '0.0.0.0', () => { t.close(() => resolve(true)) })
  })
  assert('E. server does NOT hold 0.0.0.0:port (bound to 127.0.0.1 only)', canBindZero, canBindZero ? 'confirmed loopback-only' : 'app appears bound to 0.0.0.0')
}

// Test F: token NEVER appears in stdout/stderr
{
  const inStdout = stdoutBuf.includes(TOKEN)
  const inStderr = stderrBuf.includes(TOKEN)
  assert('F. token absent from stdout', !inStdout, inStdout ? 'FOUND IN STDOUT' : '')
  assert('F2. token absent from stderr', !inStderr, inStderr ? 'FOUND IN STDERR' : '')
}

// Test G: CORS reflects file:// and localhost origins, but NOT arbitrary web origins
{
  const r1 = await fetch(`${base}/api/ask`, { method: 'OPTIONS', headers: { Origin: 'file://', 'Access-Control-Request-Method': 'POST' } })
  const allowFile = r1.headers.get('access-control-allow-origin')
  assert('G1. OPTIONS from file:// gets ACAO reflected', allowFile === 'file://', `ACAO=${allowFile}`)

  const r2 = await fetch(`${base}/api/ask`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
  const allowLocal = r2.headers.get('access-control-allow-origin')
  assert('G2. OPTIONS from localhost:5173 gets ACAO reflected', allowLocal === 'http://localhost:5173', `ACAO=${allowLocal}`)

  const r3 = await fetch(`${base}/api/ask`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example.com', 'Access-Control-Request-Method': 'POST' } })
  const allowEvil = r3.headers.get('access-control-allow-origin')
  assert('G3. OPTIONS from evil.example.com does NOT get ACAO', !allowEvil, `ACAO=${allowEvil}`)
  assert('G4. OPTIONS from evil.example.com returns 403', r3.status === 403, `got ${r3.status}`)
}

// Test H: X-Powered-By header stripped
{
  const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ provider: 'openai', prompt: 'hi' }) })
  const xpb = r.headers.get('x-powered-by')
  assert('H. X-Powered-By header removed', !xpb, `got ${xpb}`)
}

proc.kill()
await delay(200)

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
process.exit(0)
