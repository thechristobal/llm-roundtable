import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ANTHROPIC_MODEL } from '../models.js'

// Composed safety flags approximating --restricted (not yet in installed CLI):
//   - --tools ""              : no built-in tools (Bash, Edit, Read, etc.)
//   - --disallowedTools mcp__*: block MCP tools even if a config sneaks one in
//   - --disable-slash-commands: no plugin/skill execution from prompt content
//   - --strict-mcp-config     : ignore user's MCP servers
//   - --setting-sources project: don't load user's global/local Claude Code settings
//   - --no-session-persistence: don't write session to ~/.claude/
const SAFETY_FLAGS = [
  '--tools', '',
  '--disallowedTools', 'mcp__*',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--setting-sources', 'project',
  '--no-session-persistence',
]

const TURN_TIMEOUT_MS = 120_000

// The claude CLI on Windows is a `.cmd` shim that CALLs the real `claude.exe`.
// Spawning the .cmd requires `shell: true` (CVE-2024-27980 lockdown), which
// routes the long multiline --system-prompt argument through cmd.exe's parser
// and silently drops or mangles it. Resolve to the real .exe once and spawn
// that directly — no shell, no cmd interpolation.
let cachedBinPath: string | null = null

function resolveClaudeBinary(): string {
  if (cachedBinPath) return cachedBinPath
  if (process.platform !== 'win32') {
    cachedBinPath = 'claude'
    return cachedBinPath
  }
  try {
    const whereOut = execFileSync('where', ['claude.cmd'], { encoding: 'utf-8' })
    const shimPath = whereOut.split(/\r?\n/).map(s => s.trim()).find(Boolean)
    if (!shimPath) throw new Error('claude.cmd not found on PATH')
    const shim = fs.readFileSync(shimPath, 'utf-8')
    // Shim invokes: "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*
    const match = shim.match(/"([^"]+claude\.exe)"/i)
    if (!match) {
      cachedBinPath = shimPath
      return cachedBinPath
    }
    const exe = match[1].replace(/%dp0%\\?/gi, path.dirname(shimPath) + path.sep)
    cachedBinPath = fs.existsSync(exe) ? exe : shimPath
    return cachedBinPath
  } catch {
    cachedBinPath = 'claude.cmd'
    return cachedBinPath
  }
}

type CliJsonResult = {
  type: 'result'
  subtype: 'success' | string
  is_error: boolean
  api_error_status: number | null
  result?: string
}

// Writes systemPrompt to a temp file and returns the path plus a cleanup fn.
// Using --system-prompt-file keeps prompt text out of argv entirely; no cmd.exe
// or shell can see it, regardless of length or content.
function writeSystemPromptFile(systemPrompt: string): { file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtable-claude-'))
  const file = path.join(dir, 'system-prompt.txt')
  fs.writeFileSync(file, systemPrompt, 'utf-8')
  return {
    file,
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } },
  }
}

export async function askAnthropicViaCli(prompt: string, systemPrompt?: string): Promise<string> {
  const promptFile = systemPrompt ? writeSystemPromptFile(systemPrompt) : null
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', ANTHROPIC_MODEL,
    ...SAFETY_FLAGS,
    ...(promptFile ? ['--system-prompt-file', promptFile.file] : []),
  ]

  return new Promise((resolve, reject) => {
    const bin = resolveClaudeBinary()
    const child = spawn(bin, args, {
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      promptFile?.cleanup()
      reject(new Error(`Claude Code CLI timed out after ${TURN_TIMEOUT_MS / 1000}s`))
    }, TURN_TIMEOUT_MS)

    child.on('error', err => {
      clearTimeout(timer)
      promptFile?.cleanup()
      reject(new Error(`Failed to spawn Claude Code CLI (${bin}): ${err.message}`))
    })

    child.on('close', code => {
      clearTimeout(timer)
      promptFile?.cleanup()

      if (code !== 0) {
        reject(new Error(`Claude Code CLI exited ${code}: ${stderr.trim() || '(no stderr)'}`))
        return
      }

      let parsed: CliJsonResult
      try {
        parsed = JSON.parse(stdout)
      } catch {
        reject(new Error(`Claude Code CLI returned non-JSON output: ${stdout.slice(0, 500)}`))
        return
      }

      if (parsed.is_error) {
        const status = parsed.api_error_status
        const detail = parsed.result ?? `api_error_status=${status}`
        if (status === 429) {
          reject(new Error(`QUOTA_EXCEEDED: ${detail}`))
        } else if (status === 529 || status === 503) {
          reject(new Error(`CLAUDE_OVERLOADED: ${detail}`))
        } else {
          reject(new Error(`Claude Code CLI error: ${detail}`))
        }
        return
      }

      if (typeof parsed.result !== 'string') {
        reject(new Error('Claude Code CLI returned no result field'))
        return
      }

      resolve(parsed.result)
    })
  })
}
