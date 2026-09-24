# Roundtable — Context & Changelog

This file is the source of truth for project state across sessions. Update it at the end of every working session.

---

## What This Project Is

**Roundtable** (repo: `llm-roundtable`) is a desktop application where users submit a prompt and multiple LLMs (ChatGPT, Claude, Gemini) respond in parallel, then debate and critique each other across multiple rounds.

**Purpose:** Portfolio project targeting a job at Vynyl. Meant to demonstrate hands-on experience with AI orchestration, Electron desktop packaging, TypeScript, and good architecture thinking.

**Note on AWS:** Early planning discussed an AWS-hosted web version as a follow-on. It has not been implemented and is out of scope for the current desktop distribution. Do not describe AWS as part of the current architecture.

---

## Debate Flow

1. User enters prompt
2. First pass: all models respond in parallel
3. Each model sees the others' responses → identifies agreement, disagreement, direct challenges
4. Rebuttal round (targeted: "Claude objects to X — respond")
5. Repeat as warranted

---

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | Runs as Electron renderer in packaged app |
| Desktop packaging | Electron + Electron Forge (Squirrel Windows) | Active — root-level electron/ + package.json |
| Backend (local) | Express (Node) | esbuild-bundled single server.js, spawned via `child_process.spawn` under Electron main with `ELECTRON_RUN_AS_NODE=1` |
| OpenAI integration | @openai/codex-sdk + @openai/codex binary | Bundled platform binary; auth via codex login (ChatGPT subscription) |
| Anthropic integration | Claude Code CLI subprocess (primary) + @anthropic-ai/sdk (fallback) | Subscription auth via the installed `claude` binary; optional user API key stored in OS keychain via Electron safeStorage |
| Gemini integration | @google/generative-ai | User API key, stored in OS keychain via Electron safeStorage |
| Jev (referee) integration | TypeSafe System One (BYO) | User API key, stored in OS keychain via Electron safeStorage; absent → app falls back to demo/mock scoring |
| Auto-update | Not implemented | `electron-updater` is wired but no publish target yet; app swallows the missing `app-update.yml` error |
| Streaming | Not implemented | Per-panel progressive reveal only |

---

## Architecture Decisions & Rationale

- **Adapter/normalization layer** over LLM providers: app is provider-agnostic; adding a new model = writing one new adapter. This is the **adapter pattern**, not microservices (adapters live inside one Lambda, not as independently deployable services).
- **Web first, Electron later**: React is going inside Electron anyway. Get the UI working in a browser first — easier debugging, better tooling. Now packaging into Electron.
- **Lambda TS orchestration first, Step Functions later**: Better portfolio story to migrate *when the workflow demands it* (retries, branching, multi-round) than to wire it in preemptively. Shows understanding of *why* Step Functions exists.
- **No Grok**: User explicitly does not want to give Elon Musk money.
- **Electron + Express child process**: Express server is compiled to a single esbuild bundle and spawned as a child process by Electron's main process. Keeps server logic separate and unchanged; Electron manages lifecycle.
- **User-owned credentials via OS keychain**: API keys for Anthropic and Gemini stored in OS keychain via Electron `safeStorage`. OpenAI handled via Codex App Server using user's ChatGPT subscription (codex login). Keys are never stored in plaintext or in any file the app controls.
- **Desktop-only for now, no hosted backend**: Users pay their own API bills; the app talks directly to providers from their machine. An AWS-hosted web version was scoped early but is not implemented and is not part of the current architecture.
- **Anthropic subscription auth via Claude Code CLI subprocess**: Anthropic's Legal and Compliance page permits third-party apps to spawn the unmodified `claude` binary and let users sign in with their own subscription. Roundtable uses this as the primary path (subprocess spawn with composed safety flags; no credential reads/writes, no login UI). API key path preserved as an explicit alternative. Kill switch: `ROUNDTABLE_DISABLE_CLAUDE_CLI=1` in the Electron main env forces the API-key path only.
- **OpenAI via Codex App Server**: Uses `@openai/codex-sdk` + bundled platform binary. User authenticates once via `codex login` (ChatGPT subscription, available on Free and all paid tiers). Agent constrained to text-only responses — no file access, shell commands, or coding tools during debates.

---

## System Prompt Design

Competitive peer review framing — not pure adversarialism (which causes "debate-club brain" where disagreement is manufactured). Each model is told:
- You are competing for the best answer
- Look for errors, omissions, weak assumptions, bad framing, unsupported claims
- Give credit when another answer is genuinely stronger
- Do not manufacture disagreement just to appear independent
- Score depends on correctness, usefulness, reasoning quality, and catching others' mistakes

---

## Planned Model Support

- [x] ChatGPT (OpenAI)
- [x] Claude (Anthropic)
- [x] Gemini (Google)
- [ ] DeepSeek
- [ ] Llama
- [ ] Mistral
- [ ] Local model

---

## UI Concepts

- Three columns/cards with model avatars
- Streamed responses appearing simultaneously
- Consensus indicators: consensus / disputed / direct disagreement
- Action buttons: "Fight about this", "Seek consensus", "Devil's advocate", "Fact-check each other", "Judge the debate"
- User can be the judge; "Judge the debate" routes to the third model when two disagree

---

## Distribution & Auth Architecture

**Project structure (root-level):**
```
electron/          ← Electron main process + preload
client/            ← React/Vite renderer (existing)
server/            ← Express server (existing, esbuild-bundled for packaging)
package.json       ← Root; Electron Forge config lives here
```

**Provider auth model:**
| Provider | Auth method | Storage |
|---|---|---|
| OpenAI (ChatGPT) | Codex App Server — `codex login` (ChatGPT subscription) | `~/.codex/auth.json` (managed by Codex) |
| Anthropic (Claude) | Claude Code CLI subscription (primary) OR user API key (alternative) | CLI reads its own credentials (Roundtable never touches `~/.claude/`); API key in OS keychain via Electron `safeStorage` |
| Gemini | User API key | OS keychain via Electron `safeStorage` |
| Jev (TypeSafe) | User API key (optional; absent → demo/mock scoring) | OS keychain via Electron `safeStorage` |

**First-run screen:** Single "Provider Setup" screen on first launch (or when any provider is unconfigured). All three providers visible simultaneously, each skippable. Codex shows a "Connect with ChatGPT" button; Anthropic and Gemini show paste fields with live validation. Green checkmark per provider on success.

**Settings:** Persistent settings access from the main UI header. Shows connection status per provider; allows re-auth, key rotation, and disconnect.

**Packaging:**
- Windows: Squirrel installer via Electron Forge — validated end-to-end in a packaged build
- Mac: Not built yet
- Code signing: Not implemented — installer is unsigned and triggers SmartScreen ("More info → Run anyway"). Documented in the README; revisit Azure Trusted Signing if real-user distribution warrants it.
- Auto-update: `electron-updater` wired but no publish target yet
- Server: esbuild bundle → single `server.js` in app resources; spawned via `child_process.spawn(process.execPath, [serverScript], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })` because `utilityProcess.fork` cannot bind TCP sockets on Windows (UV_UNKNOWN errno -4094 on `listen`)

---

## Jev — AI Judge Panel

Jev (TypeSafe AI System One) is an independent judge that evaluates each debate round and the full debate. Not one of the three debaters.

**Scoring dimensions (weighted):**
| Dimension | Weight | What it measures |
|---|---|---|
| Reasoning | 40% | Logical structure and argument quality |
| Intellectual Honesty | 33% | Acknowledges uncertainty, avoids strawmanning |
| Coherence | 22% | Internal consistency, no self-contradiction |
| Precision | 5% | Specificity of empirical claims (low weight: Jev can't fact-check) |

**Special flags (noul questions):**
- **Task Adherence** (hard gate — DQ): If the response failed to engage with the prompt, it is disqualified for that round regardless of dimension scores. Overall cell shows "DQ" in the round scorecard. Individual dim scores remain visible for diagnostic value. Whole-debate winner is not mechanically gated — Jev can weigh recovery across later rounds. Semantics of the underlying `relevance.noul` field were verified against real Jev responses (off-topic probe → noul 0.99, on-topic probe → noul 0.02).
- **EQ Anchor**: If no evidentiary burden incurred, Precision score anchored to 5.0
- **Contradiction cap**: If material self-contradiction detected, Coherence capped at 1.0
- **Fabrication detection** (experimental): Caps Precision at 1.0 and IH at 3.0 if fired; triggers follow-up span-localization call; highlights suspected spans in UI with "unverified claim — in testing" tooltip

**Fabrication span visibility:** After Jev scores a round, suspected fabrication spans for competitor responses are included in subsequent debate prompts with a strong false-positive caveat. Models may independently investigate but are not forced to engage.

---

## Stretch Goals (do not block v1)

- **Dynamic panel count + provider/model selection** — dropdown to choose how many panels, which provider each one uses, and which specific model. Enables running one provider against itself across models.
- **RAG / embeddings / vector DB** — embed response chunks and compare semantic similarity to distinguish "these two models essentially agree" from "these answers are making genuinely different claims." This is the *natural* entry point for embeddings in this app — it solves a real problem (accurate consensus/disputed detection) rather than bolting on an unrelated feature like a document chatbot.
- Saved debates / user accounts
- Login/landing page for final product
- Branching conversations
- **Harden positions mode** — debate action button: models dig in harder, defend positions more aggressively
- **Jev passive consensus detection** — after each round, Jev surfaces per-topic agreement/disagreement indicators
- **Provider abstention classification** — detect policy refusals; `responseStatus: 'abstained'` distinct from `error`
- **Precision scoring via separate model** — Mistral/Perplexity for live claim verification (filed as stretch; current Jev-based Precision is experimental)
- Token/cost tracking
- Voting / evaluations
- User-created panel personas
- Model icons/logos in panel headers
- Public share links
- Local model support
- **Export debate to file** — ✓ built (HTML with KaTeX)
- **Import debate from file** — ✓ built
- **Jev judge panel** — ✓ built (round scoring + final verdict + fabrication detection)

---

## Claude Skills Active

- **Learning Opportunities** — Claude pauses and has user exercise concepts
- **Matt Pocock** — Menu of individual workflows invoked as needed
- NOT using Superpowers

---

## Setup Checklist

- [x] Create GitHub repo: `llm-roundtable`
- [x] Obtain API keys: OpenAI, Anthropic, Gemini
- [x] Initialize project (React + TypeScript)
- [x] Set up Electron Forge
- [x] Windows packaged build validated end-to-end
- [ ] Clean-machine install test (blocks any further feature work)
- [ ] GitHub Release with Windows installer
- [ ] 60–90s Loom demo (not a blocker)

---

## Adam's Notes (mentor/contact)

- YouTube link to revisit after Roundtable: https://www.youtube.com/watch?v=KvoBrUd1-5E
- After Roundtable: read *Head First Design Patterns*

---

## Changelog

### 2026-09-12 — Session 1: Project Kickoff
- Reviewed Vynyl Notes document
- Established project scope, tech stack, architecture decisions
- Decided: web app first, Electron later
- Decided: Lambda TS orchestration first, Step Functions on migration
- Decided: adapter pattern (not microservices) for provider normalization
- Decided: streaming is a planned early feature, not a day-one gate
- Decided: RAG/embeddings/vector DB → stretch goal
- Claude Skills confirmed: Learning Opportunities + Matt Pocock (no Superpowers)
- CONTEXT.md created

### 2026-09-13 — Session 2 (overnight): Setup
- Created GitHub repo: https://github.com/thechristobal/llm-roundtable
- Scaffolded monorepo: client/ (React + TypeScript + Vite) + server/ placeholder
- Full build done on main branch, tagged snapshot/overnight-v1
- API keys obtained and stored in server/.env.local (gitignored)
- Learning Opportunities + Matt Pocock skills installed globally

### 2026-09-13 — Session 3: Workshop branch + types
- Switched to Learning Opportunities mode going forward
- Created workshop branch from initial scaffold; overnight build on main as reference
- Built client/src/types/index.ts:
  - ProviderID — string union (not ModelID; providers ≠ models)
  - PanelState — discriminated union on status: idle/loading/complete/error (not ModelResponse)
  - ProviderConfig — type for provider display/API config
  - PROVIDERS — Record<ProviderID, ProviderConfig> constant, single source of truth
- Added stretch goals: user-owned API keys, dynamic panel/provider/model selection
- Format going forward: write code first, explain after

### 2026-09-14 — Session 4: Server, UI polish, export

- Built Express server (server/src/index.ts): /api/ask (initial) + /api/debate/ask (per-provider debate)
- Adapter pattern: openai.ts, anthropic.ts, google.ts; unified LLMAdapter interface
- Built debate prompt system (debatePrompt.ts): history blocks, fight/follow_up directives, elimination tracking
- Gemini error handling: 6 retries, QUOTA_EXCEEDED (429) and GEMINI_OVERLOADED (503) prefixes, distinct UI treatment
- UI: rounds state, per-panel scroll (h-96 grid), PromptLabel with line-clamp + expand, DebateBar (fight action)
- Retry button on error panels for current round only
- HTML export with offline KaTeX (base64 woff2), exporter registry pattern
- Per-panel progressive reveal: panels update as each fetch resolves, don't wait for all three
- Added remark-gfm for table support in ProviderPanel and HTML export
- Round numbering: "Opening Statements" for initial round, "Round N" for debate rounds
- Absent-model rule added to debate prompts
- Provider abstention classification added to stretch goals

### 2026-09-14 to 2026-09-20 — Sessions 5–6: Jev integration + scoring framework

- Integrated Jev (TypeSafe AI System One) as independent debate judge
- Built `/api/judge/round` and `/api/judge/final` endpoints
- Scoring: Reasoning 40% / Intellectual Honesty 33% / Coherence 22% / Precision 5%
- Special flags: Task Adherence (pass/fail), EQ anchor (no evidentiary burden → Precision = 5.0), Contradiction cap (Coherence capped at 1.0), Fabrication detection (experimental)
- Fabrication span localization: follow-up Jev call splits response into sentence spans, highlights high-confidence spans in UI with "unverified claim — in testing" tooltip
- Fabrication spans included in subsequent debate prompts with false-positive caveat
- JevRoundScores component: per-provider scorecard below each round
- JevPanel component: final verdict with minimize toggle and agree/disagree user reaction
- User votes: multi-select per round (Set<ProviderID>), not single-select
- Models see Jev's final judgment in all subsequent rounds after Judge is called
- Seek Consensus action button live (fight + seek_consensus in DebateBar)
- Import debate from HTML file
- Renamed "Evidence Quality" → "Precision"; updated rubric to focus on specificity/groundedness
- Ran 6-round internal debate to determine scoring weights; synthesized consensus
- Committed and pushed all work to workshop branch

### 2026-09-23 — Session 7: Electron packaging architecture + grilling

- Decided: Electron desktop app is the distribution path (not AWS web hosting — those are separate stories)
- Project structure: root-level `electron/` + root `package.json` for Forge; `client/` and `server/` unchanged
- Server packaging: esbuild → single `server.js` bundled in app resources; spawned as child process
- Auto-update: `electron-updater` + GitHub Releases; Windows now, Mac later
- Provider auth decisions:
  - OpenAI: Codex App Server (`@openai/codex-sdk` + bundled platform binary); user authenticates via `codex login` (ChatGPT subscription, available on all tiers including Free); constrained to text-only responses
  - Anthropic: User API key in OS keychain via `safeStorage` (subscription OAuth permanently banned for third parties, server-side blocked since Jan 2026)
  - Gemini: User API key in OS keychain via `safeStorage`; live-validated on paste
- First-run: single Provider Setup screen, all three providers visible and skippable
- Settings: persistent header access, connection status per provider
- Codex SDK research: determining exact text-only constraint config before implementation (pending)

### 2026-09-23 — Session 8: Electron shell + Claude Code CLI adapter

- Electron shell smoke test passed: Settings opens, OpenAI shows connected via Codex, Gemini credential saves and persists, real Roundtable prompt completes end-to-end in Electron
- Corrected prior wrong conclusion: Anthropic's Legal/Compliance page explicitly permits third-party apps to spawn the unmodified `claude` binary with user's subscription (hosting-platform carve-out). Subscription-via-CLI is a supported distribution path.
- Discovery: existing `askAnthropic` was already using subscription auth via `@anthropic-ai/claude-agent-sdk` (env filter stripped `ANTHROPIC_API_KEY` before calling `query()`), meaning the "Anthropic API key" tile was a no-op. Fixed.
- Adapter refactor:
  - `server/src/models.ts` — centralized `ANTHROPIC_MODEL='claude-sonnet-5'`, `OPENAI_MODEL`, `GOOGLE_MODEL`
  - `server/src/features.ts` — `CLAUDE_CLI_ENABLED` build-time flag with `ROUNDTABLE_DISABLE_CLAUDE_CLI=1` env kill switch
  - `server/src/adapters/anthropic-cli.ts` — spawns `claude -p` with composed safety flags (`--tools ""`, `--disallowedTools mcp__*`, `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources project`, `--no-session-persistence`); `cwd: os.tmpdir()`, 120s timeout, JSON error mapping to QUOTA_EXCEEDED/CLAUDE_OVERLOADED
  - `server/src/adapters/anthropic-api.ts` — real `@anthropic-ai/sdk` Messages call with system prompt support
  - `server/src/adapters/anthropic.ts` — dispatcher reads `ROUNDTABLE_CLAUDE_BACKEND` env
  - `server/src/adapters/anthropic-agent-sdk.ts.reference` — original SDK-agent code preserved (`.reference` suffix keeps esbuild out)
- Electron main.ts: added `claude auth status` detection (parses `loggedIn`, `authMethod`, `subscriptionType` from JSON output; cache per session; refresh on Settings open). Passes `ROUNDTABLE_CLAUDE_BACKEND=cli|api|none` when spawning server based on stored key presence + CLI status.
- Verified `--tools ""` genuinely blocks tool execution (side-effect test: Write tool did NOT create file despite model claiming it did — model self-reports about tool availability are unreliable, use side-effect verification)
- Verified `--restricted` flag does NOT exist in claude 2.1.116 — composed the equivalent behavior with existing flags; noted `--restricted` as future single-flag collapse target
- Verified `claude-sonnet-5` reachable directly (the `sonnet` alias still resolves to `claude-sonnet-4-6` in this CLI version — alias-updater lags)
- UI: 5-state Anthropic tile in ProviderSetup — (1) CLI connected + subtitle, (2) CLI detected but logged out with terminal-command instructions, (3) CLI missing with API-key input + install link, (4) API key stored with optional "Switch to Claude Code" if CLI also available, (5) flag off hides all CLI copy. Per Anthropic condition #4 we only INSTRUCT terminal login — no login UI inside Roundtable.
- 10 conditions from Anthropic terms verification we're honoring: don't modify/repackage `claude` binary; don't touch `~/.claude/`; don't restrict CLI's built-in auth methods; no Login-with-Claude UI; no spoofed client_id/User-Agent; don't bill users for Claude usage; trademark hygiene (tile stays "Claude" as nominative fair use, subtitle discloses backend); agree to Anthropic Commercial Terms of Service at distribution time; don't encourage abnormal usage; feature flag kill switch retained

### 2026-09-23 — Session 9: Windows spawn bugs, Codex bundle path, credential-airtight packaging

- Fixed two integration bugs discovered in first end-to-end smoke test of Session 8 code:
  1. **Claude CLI dropped the system prompt on Windows.** Root cause: `spawn('claude.cmd', args, { shell: true })` on Windows routes every arg through cmd.exe's parser, which silently mangles long multi-line strings. Fix: resolve the `.cmd` shim to the real `claude.exe` (native .exe living next to the shim; path scraped from shim contents) and spawn that directly — no `shell: true`, no cmd interpolation. Additionally switched from `--system-prompt <string>` to `--system-prompt-file <path>` writing to a per-call tempfile (cleaned up on close/timeout/error). The `-file` variants aren't in the main `--help` output but are functional and documented in the `--bare` help section. Prompt text never touches argv now.
  2. **Codex SDK could not locate its binary after esbuild bundled it.** Root cause: `@openai/codex-sdk` uses `createRequire(import.meta.url).resolve('@openai/codex/package.json')`; after esbuild bundles the SDK into `electron/resources/server.js`, that require is rooted at `electron/resources/` where the `@openai/codex*` packages don't exist (they're in `server/node_modules/`). Fix: pass `codexPathOverride` to the `Codex` constructor with a resolver that walks up 10 dir levels from `__dirname` looking for `node_modules/<platform-pkg>/vendor/<triple>/bin/codex[.exe]`, plus cwd-based backstop.
- End-to-end verification: probed all three providers via `POST /api/ask` with a system-prompt-sensitive question ("who are you and who are you competing against"). Each returned its correct identity plus named the other two competitors → system prompt reached in all three cases.
- Packaging credential-airtight: added `packagerConfig.ignore` predicate excluding dotenv family, `auth.json`, `provider-keys.json`, `.claude/`, `.rtf`, and `CONTEXT.md`. Verified by running `npm run package` and grepping the produced `out/llm-roundtable-win32-x64/` tree three ways: (a) `find` for filename patterns → 0 hits; (b) grep for actual dev API key values in `server.js` + `app.asar` → 0 hits; (c) `@electron/asar list` (16,149-file manifest) for sensitive names → 0 hits.
- Distribution-safety recap: shipped app has zero path to my credentials. Claude reads `claude auth status` on user's PATH; Codex reads user's `~/.codex/auth.json`; API keys stored per-user via Electron `safeStorage` in userData. Packaged Electron main deliberately starts server with a clean env (no dotenv inheritance) — dev-time inheritance path is dev-only.

### 2026-09-23 — Session 10: Packaged-build validation, BYO Jev, DQ gate

Full run at packaged Windows build validation, followed by two product fixes and one distribution hardening pass.

**Packaging bugs found and fixed in the packaged Windows build:**
- `utilityProcess.fork` cannot bind TCP sockets on Windows (UV_UNKNOWN errno -4094 on `listen`). Switched to `child_process.spawn(process.execPath, [serverScript], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })` — re-executes Electron as plain Node, same runtime, works.
- Squirrel installer required `Authors` field in the generated nuspec — added `"author": "Christobal"` to `package.json`.
- Bundled platform binaries (`codex.exe`, `claude.cmd`) were trapped in asar and unspawnable. `AutoUnpackNativesPlugin` only unpacks `.node` files (glob `**/{.**,**}/**/*.node`). Added `packagerConfig.asar.unpack: '**/*.{exe,dll,node,dylib,so}'` for all platform binaries.
- Codex SDK's `findCodexBinary()` couldn't locate its unpacked binary. Extended `candidateNodeModulesRoots()` in `openai.ts` to walk `app.asar.unpacked/server/node_modules` and `app.asar.unpacked/node_modules`.
- 790MB asar bloat → 67MB by excluding `client/node_modules` (Vite already inlined the renderer), `.git/`, and `.agents/` via `packagerConfig.ignore` predicate.
- Renderer 404 in packaged build: `client/vite.config.ts` has `root: client/` so Forge's Vite plugin writes to `client/.vite/renderer/main_window/`, not the project-root `.vite/renderer/`. Fixed `win.loadFile()` path in `electron/main.ts`.
- `autoUpdater` emitted unhandled `ENOENT: app-update.yml` on every launch. Added `.on('error')` + `.catch()` around `checkForUpdatesAndNotify()` — no publish target yet, error swallowed cleanly.

**Renderer/backend connectivity fix (renderer lost the backend after any key save):**
- Root cause: `preload.ts` snapshots `serverPort` **once** via `ipcRenderer.sendSync('get-server-port')` at page load and never re-fetches. `restartServer()` was calling `getFreePort()` on every restart, so the renderer's API base URL silently pointed at a dead port after any key save/delete.
- Fix: pick the port **once** at first startup (`if (!serverPort) serverPort = await getFreePort()`) and reuse across restarts. Also `await` the old child's `exit` event before spawning the new one — a bare `setTimeout` wasn't long enough on Windows and the new server raced the old socket into EADDRINUSE. TIME_WAIT does not apply to listening sockets, so rebinding on the same port is safe.

**Mock verdict consistency (`server/src/adapters/jev.ts`):**
- Prior mock winner was hardcoded and could contradict displayed scores (e.g., "ChatGPT wins" while Claude had the highest displayed Overall). Refactored `mockResponse()` to derive the winner from the same `mockScoreFor(${p}_overall)` scores that populate the scorecard; confidence proportional to the margin between top and second place (clamped 0.35–0.95). Verdict can no longer contradict the visible scorecard.

**BYO Jev/TypeSafe credential path:**
- Added `typesafe` as a fourth provider in Settings — key encrypted via `safeStorage`, injected into server env as `TYPESAFE_API_KEY`.
- `validateApiKey('typesafe', key)` in `electron/main.ts` probes `https://api.typesafe.ai/v1/systemone` with a trivial noul question (~cent-fraction cost) to catch bad keys before save.
- UI: distinct "Referee (optional)" section under the three debaters in `ProviderSetup.tsx`. Absence badge on scorecard now reads "demo mode — add a Jev key in Settings for real scoring" instead of the meaningless-to-users "TYPESAFE_API_KEY not set".
- Continue button gate on first-run setup requires only a debater — Jev is optional.

**Task Adherence hard-gate DQ:**
- Prior behavior: Task Adherence displayed as "Fail" but had zero effect on the weighted `overall` score. Real Jev run produced Claude with TA=Fail and Overall=8.8, contradicting the gate's stated purpose.
- Fix: `disqualified = relevance.noul >= 0.5` computed per provider per round; shipped in the round payload. If disqualified, the round scorecard's Overall cell shows a red "DQ" (tooltip explains scope) instead of the weighted number. Individual dim scores kept visible for diagnosis. Whole-debate Judge winner is intentionally **not** mechanically gated — Jev's holistic `/final` call can weigh recovery.
- Verified semantics against real Jev API before shipping: off-topic probe returned `noul: 0.99`, on-topic probe returned `noul: 0.02`. Direction of comparison confirmed correct.

**Distribution status at end of session:**
- Packaged Windows build (`out/llm-roundtable-win32-x64/`) validated end-to-end: opening round, Fight, Seek Consensus, Judge, DQ gate, Jev BYO all working.
- Squirrel installer (`out/make/squirrel.windows/x64/llm-roundtable-1.0.0 Setup.exe`) produced but not yet published as a GitHub Release.
- Not yet done: clean-machine install test (blocks any further feature work), GitHub Release publish, Loom demo, README.
- Explicitly deferred: code signing (unsigned + SmartScreen click-through documented), auto-update publish target, custom landing page, model dropdowns, further polish.
