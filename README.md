# Roundtable

**A desktop app that puts ChatGPT, Claude, and Gemini in a moderated debate — and grades them on the way out.**

Roundtable takes one of your prompts, sends it to all three frontier models in parallel, lets them read each other's answers, and then runs a fight-and-consensus loop until you're ready for a verdict. An independent judge model (Jev, from TypeSafe) scores every round on reasoning, honesty, coherence, and precision — with a hard disqualification gate for any response that doesn't actually engage with the prompt.

> _Screenshot / GIF placeholder — see the [Loom shot list](#demo-shot-list) below for what a 60–90s demo captures._

---

## Try it

The current build is Windows-only. Grab the installer from the latest [GitHub Release](https://github.com/thechristobal/llm-roundtable/releases) and run it.

**Expected Windows warning:** the installer is unsigned, so Windows Defender SmartScreen will show a blue "Windows protected your PC" dialog. Click **More info → Run anyway**. Code signing (Azure Trusted Signing) is a future step gated on real-user distribution — not worth the annual cost for a portfolio download.

On first launch you'll see a Provider Setup screen. You need at least one of the three debater providers configured to start:

- **ChatGPT** — sign in with your ChatGPT subscription via the bundled `codex login`. Works on Free and paid tiers.
- **Claude** — install [Claude Code](https://docs.claude.com/en/docs/claude-code/quickstart) and `claude login` with your subscription (primary path), _or_ paste an Anthropic API key.
- **Gemini** — paste a key from [aistudio.google.com](https://aistudio.google.com).
- **Jev (referee, optional)** — paste a key from typesafe.ai for real scoring. Without a key, Jev runs in demo mode with fixed illustrative scores.

Keys are encrypted via your OS keychain (DPAPI on Windows, Keychain on macOS) through Electron's `safeStorage`. Roundtable never writes them to plaintext files.

---

## Design decisions

The interesting problem in this project isn't calling three LLMs — it's the packaging, the auth model, and making the judge actually judge. This section covers the calls I'd want to defend in an interview.

### Electron + child-process Express, not utilityProcess

The renderer is a standard Vite React app. The backend is a small Express server. In a packaged Electron app the natural first reach is `utilityProcess.fork`, which is the officially-blessed way to run Node code alongside the main process. **It doesn't work on Windows for a server that needs to bind a TCP socket** — `listen()` fails with `UV_UNKNOWN` errno -4094.

The fix is to spawn Electron itself as a plain Node process:

```ts
serverProcess = spawn(process.execPath, [serverScript], {
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  ...
})
```

Same runtime, no extra binary, TCP works. The renderer talks to `http://127.0.0.1:<port>` — the port is picked once at first startup and reused across restarts, because the preload snapshots it synchronously at page load and never re-fetches.

### Provider adapters over a shared interface

Each model lives behind an adapter (`server/src/adapters/openai.ts`, `anthropic.ts`, `google.ts`). The rest of the app is provider-agnostic. Adding a new model is one file. This is the adapter pattern — not microservices — because the adapters share a process and there's no infrastructure benefit to splitting them out.

Graceful degradation lives here too. Adapters surface prefixed error strings (`QUOTA_EXCEEDED:`, `GEMINI_OVERLOADED:`, `CLAUDE_OVERLOADED:`) that the server maps to `429` / `503` responses; the UI shows a per-panel retry button without collapsing the whole round. Any provider can drop out of any round and the debate keeps running.

### User-owned auth for every provider

Roundtable never bills you for LLM usage — you plug in your own credentials, three different ways depending on the provider:

- **OpenAI**: bundles the `@openai/codex-sdk` and its platform binary. Users sign in once with their ChatGPT subscription via `codex login`; auth lives in `~/.codex/auth.json` (Codex-managed, Roundtable doesn't touch it). Agent is constrained to text-only responses — no file access, shell commands, or coding tools during debates.
- **Anthropic**: primary path spawns the installed `claude` binary as a subprocess with composed safety flags (`--tools ""`, `--disallowedTools mcp__*`, `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources project`, `--no-session-persistence`, `cwd: os.tmpdir()`). System prompts are passed via `--system-prompt-file <tempfile>` because on Windows `cmd.exe` quietly mangles multi-line strings when they go through `argv`. API key is available as an alternative and honors a `ROUNDTABLE_DISABLE_CLAUDE_CLI=1` kill switch.
- **Gemini & Jev**: paste-and-validate. Keys are live-validated on save (Gemini via `/v1beta/models`, Jev via a trivial `noul` probe against `/v1/systemone`) so users don't discover bad keys mid-debate.

All persisted keys go through Electron `safeStorage` into `%APPDATA%\llm-roundtable\provider-keys.json` — encrypted at rest with the OS credential store.

### Jev's scoring, and the DQ gate

Jev (TypeSafe System One) scores each round on four weighted dimensions — Reasoning (40%), Intellectual Honesty (33%), Coherence (22%), Precision (5%) — plus several `noul` (boolean-ish, probability of "yes") flags: EQ burden, contradiction, fabrication, and Task Adherence.

Task Adherence was originally displayed as pass/fail with no effect on the numeric Overall score. A real Jev run produced Claude with Task Adherence = **Fail** and Overall = **8.8**, which is exactly the wrong signal — a beautifully-argued response to the wrong question is worse than a mediocre response to the right one, not better. So Task Adherence is now a **hard gate**: fail it and the round's Overall cell shows `DQ` in red, with individual dim scores preserved for diagnosis. Direction of the underlying `relevance.noul` field was verified with a real API probe (off-topic response returned `noul: 0.99`, on-topic returned `noul: 0.02`) before shipping the comparison.

The whole-debate winner is deliberately **not** mechanically gated — Jev's holistic `/final` call gets to weigh recovery across later rounds. A model that flubs Round 1 can still win the debate if it engages properly afterward.

### Packaging & runtime fixes worth knowing

Every one of these was a real bug in a real packaged build:

- Squirrel installer required an `Authors` field in the generated nuspec — added `"author"` to `package.json`.
- Bundled platform binaries (`codex.exe`, Claude Code) were trapped inside asar and unspawnable. `AutoUnpackNativesPlugin` only unpacks `.node` files; had to add `asar.unpack: '**/*.{exe,dll,node,dylib,so}'` to `forge.config.ts`.
- Codex SDK's binary resolver couldn't find its own binary after asar unpack — extended `candidateNodeModulesRoots()` to walk `app.asar.unpacked/server/node_modules`.
- 790MB asar bloat → 67MB by excluding `client/node_modules` (Vite already inlines the renderer) and `.git/`.
- The Vite plugin writes the renderer bundle to `client/.vite/renderer/main_window/` because `client/vite.config.ts` has `root: client/` — not the project-root `.vite/renderer/`. `win.loadFile()` had to back out two levels and dive in.
- `autoUpdater` emitted an unhandled `ENOENT: app-update.yml` rejection on every launch. Wrapped in `.on('error')` + `.catch()` — auto-update isn't wired to a publish target yet and this made the failure silent instead of fatal.

---

## Repo layout

```
electron/          Electron main + preload (TypeScript)
client/            React + Vite renderer
server/            Express server (esbuild-bundled to a single server.js at package time)
forge.config.ts    Electron Forge config — asar unpack rules and ignore predicate live here
```

---

## What this project is not

- **Not AWS-hosted.** An early plan discussed a hosted web version on Lambda + DynamoDB — it was never built and is not part of the current architecture. Roundtable is a desktop app; users talk to providers directly from their machine.
- **Not code-signed.** Documented above.
- **Not auto-updating.** `electron-updater` is wired but has no publish target yet.
- **Not multi-platform.** Windows Squirrel installer only. Mac build is scoped but not built.

---

## Demo shot list

For a 60–90s no-voiceover Loom that captures the value in the fewest possible seconds. Recording is a TODO; the shot list is:

1. Cold-open on Provider Setup — three tiles connected + a Jev tile in the Referee section
2. Type a spicy prompt ("Is Rust actually safer than Go, or is that oversold?")
3. Three panels stream simultaneously, all with slightly different takes
4. Click **Fight** — panels update with rebuttals
5. Click **Seek Consensus** — panels converge or explicitly refuse to
6. Click **Judge** — Jev scorecard appears with the DQ gate visible on any off-topic response, final verdict with confidence

---

## Contact

Christobal — job-seeking full-stack engineer building portfolio work. If you're at Vynyl or reading this because someone linked you here, hit me at beeceepedia@gmail.com.
