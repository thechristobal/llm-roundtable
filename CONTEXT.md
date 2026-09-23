# Roundtable — Context & Changelog

This file is the source of truth for project state across sessions. Update it at the end of every working session.

---

## What This Project Is

**Roundtable** (repo: `llm-roundtable`) is a desktop application where users submit a prompt and multiple LLMs (ChatGPT, Claude, Gemini) respond in parallel, then debate and critique each other across multiple rounds.

**Purpose:** Portfolio project targeting a job at Vynyl. Meant to demonstrate hands-on experience with AI orchestration, AWS serverless, TypeScript, and good architecture thinking.

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
| Desktop packaging | Electron + Electron Forge | Active — root-level electron/ + package.json |
| Backend (local) | Express (Node) | esbuild-bundled single server.js, spawned as child process by Electron main |
| OpenAI integration | @openai/codex-sdk + @openai/codex binary | Bundled platform binary; auth via codex login (ChatGPT subscription) |
| Anthropic integration | @anthropic-ai/sdk | User API key, stored in OS keychain via Electron safeStorage |
| Gemini integration | @google/generative-ai | User API key, stored in OS keychain via Electron safeStorage |
| Auto-update | electron-updater + GitHub Releases | Windows now, Mac later |
| Backend (hosted, future) | AWS Lambda + API Gateway | Separate story; for a future web-hosted version |
| Database (future) | AWS DynamoDB | Session storage for web version |
| Streaming | SSE or WebSockets | Planned, not yet implemented |

---

## Architecture Decisions & Rationale

- **Adapter/normalization layer** over LLM providers: app is provider-agnostic; adding a new model = writing one new adapter. This is the **adapter pattern**, not microservices (adapters live inside one Lambda, not as independently deployable services).
- **Web first, Electron later**: React is going inside Electron anyway. Get the UI working in a browser first — easier debugging, better tooling. Now packaging into Electron.
- **Lambda TS orchestration first, Step Functions later**: Better portfolio story to migrate *when the workflow demands it* (retries, branching, multi-round) than to wire it in preemptively. Shows understanding of *why* Step Functions exists.
- **No Grok**: User explicitly does not want to give Elon Musk money.
- **Electron + Express child process**: Express server is compiled to a single esbuild bundle and spawned as a child process by Electron's main process. Keeps server logic separate and unchanged; Electron manages lifecycle.
- **User-owned credentials via OS keychain**: API keys for Anthropic and Gemini stored in OS keychain via Electron `safeStorage`. OpenAI handled via Codex App Server using user's ChatGPT subscription (codex login). Keys are never stored in plaintext or in any file the app controls.
- **AWS is the web version story, not the desktop story**: Electron = desktop app, user pays their own API bills. AWS = future hosted web version. These are separate distribution paths, not the same thing.
- **Anthropic subscription OAuth is off the table**: Officially banned for third-party apps and server-side blocked since January 2026. API key only for Anthropic.
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
| Anthropic (Claude) | User API key | OS keychain via Electron `safeStorage` |
| Gemini | User API key | OS keychain via Electron `safeStorage` |

**First-run screen:** Single "Provider Setup" screen on first launch (or when any provider is unconfigured). All three providers visible simultaneously, each skippable. Codex shows a "Connect with ChatGPT" button; Anthropic and Gemini show paste fields with live validation. Green checkmark per provider on success.

**Settings:** Persistent settings access from the main UI header. Shows connection status per provider; allows re-auth, key rotation, and disconnect.

**Packaging:**
- Windows: Squirrel installer via Electron Forge, auto-update via `electron-updater` + GitHub Releases
- Mac: Planned for later
- Server: esbuild bundle → single `server.js` in app resources; spawned with Electron's bundled Node

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
- **Task Adherence**: Pass/fail — did the model actually answer what was asked?
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

## Setup Checklist (not yet started as of session 1)

- [ ] Create GitHub repo: `llm-roundtable`
- [ ] Set up AWS account
- [ ] Obtain API keys: OpenAI, Anthropic, Gemini (accounts exist, keys not yet generated)
- [ ] Initialize project (React + TypeScript)
- [ ] Set up Electron Forge (deferred)

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

### Next session: Implement Electron scaffolding once Codex SDK research resolves
