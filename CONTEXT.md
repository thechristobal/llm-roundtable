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
| Frontend | React + TypeScript | Web app first; packaged into Electron later |
| Desktop packaging | Electron (via Electron Forge) | Deferred until UI is stable |
| Backend | AWS Lambda | TypeScript orchestration to start |
| API routing | AWS API Gateway | Trigger for Lambda |
| Database | AWS DynamoDB | Session/debate storage |
| Orchestration (later) | AWS Step Functions | Migrate from Lambda TS when workflow becomes multi-stage |
| Streaming | SSE or WebSockets | Planned early feature, not day-one requirement |

---

## Architecture Decisions & Rationale

- **Adapter/normalization layer** over LLM providers: app is provider-agnostic; adding a new model = writing one new adapter. This is the **adapter pattern**, not microservices (adapters live inside one Lambda, not as independently deployable services).
- **Web first, Electron later**: React is going inside Electron anyway. Get the UI working in a browser first — easier debugging, better tooling. Package into Electron once stable.
- **Lambda TS orchestration first, Step Functions later**: Better portfolio story to migrate *when the workflow demands it* (retries, branching, multi-round) than to wire it in preemptively. Shows understanding of *why* Step Functions exists.
- **No Grok**: User explicitly does not want to give Elon Musk money.

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

## Stretch Goals (do not block v1)

- **RAG / embeddings / vector DB** — embed response chunks and compare semantic similarity to distinguish "these two models essentially agree" from "these answers are making genuinely different claims." This is the *natural* entry point for embeddings in this app — it solves a real problem (accurate consensus/disputed detection) rather than bolting on an unrelated feature like a document chatbot.
- Authentication
- Saved debates
- Branching conversations
- Token/cost tracking
- Voting / evaluations
- User-created panel personas
- Public share links
- Local model support

---

## Claude Skills Active

- **Learning Opportunities** — Claude pauses and has user exercise concepts
- **Matt Pocock** — Menu of individual workflows invoked as needed
- NOT using Superpowers

---

## Setup Checklist

- [x] Create GitHub repo: `https://github.com/thechristobal/llm-roundtable`
- [x] Initialize project — React + TypeScript (Vite), monorepo with `client/` and `server/`
- [x] Install Learning Opportunities and Matt Pocock skills globally (`~/.claude/commands/`)
- [ ] **AWS account** — requires credit card + phone verification, needs you present
- [ ] **API keys** — Playwright couldn't auto-generate them (consoles have separate sessions from regular logins). You need to do these manually — 2 minutes each:
  - OpenAI: platform.openai.com → API Keys → Create new secret key
  - Anthropic: console.anthropic.com → Settings → API Keys → Create Key
  - Google: aistudio.google.com/apikey → Create API Key (select or create a project)
  - Once you have them: create `server/.env.local` (already gitignored) using `server/.env.example` as a template
- [ ] Set up Electron Forge (deferred until UI is stable)

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
- Decided: RAG/embeddings/vector DB → stretch goal (natural entry: embed response chunks to detect genuine disagreement vs. paraphrase)
- Claude Skills confirmed: Learning Opportunities + Matt Pocock (no Superpowers)
- CONTEXT.md created

### 2026-09-13 — Session 2: Overnight build
- Created GitHub repo: `https://github.com/thechristobal/llm-roundtable` (via Playwright + Opera)
- Scaffolded monorepo: `client/` (React + TypeScript + Vite + Tailwind v4) + `server/` (Express + TypeScript)
- **Frontend built:**
  - `client/src/types/index.ts` — shared types using discriminated union for `ModelResponse`, `satisfies` for model configs
  - `client/src/components/ModelPanel.tsx` — per-model response card with loading skeleton, streaming cursor, error state
  - `client/src/components/PromptInput.tsx` — textarea with Enter-to-submit, Shift+Enter for newline
  - `client/src/hooks/useRoundtable.ts` — state management, fires all 3 API calls via `Promise.allSettled` in parallel
  - `client/src/App.tsx` — three-column layout, header with Clear button, sticky prompt footer
  - Tailwind v4 with custom CSS variables for model accent colors
- **Server built:**
  - `server/src/adapters/openai.ts` — OpenAI GPT-4o adapter
  - `server/src/adapters/anthropic.ts` — Anthropic Claude Sonnet adapter
  - `server/src/adapters/google.ts` — Google Gemini 1.5 Pro adapter
  - `server/src/routes/chat.ts` — POST /api/chat, falls back to labeled mock responses if API key missing
  - `server/src/index.ts` — Express app on port 3001, logs which keys are present at startup
  - Vite proxy configured: `/api` → `http://localhost:3001` during dev
- Installed Learning Opportunities + Matt Pocock skills globally
- API keys: Playwright attempted but all 3 consoles require separate login sessions. **Manual generation needed** (see Setup Checklist)
- Both client and server pass `tsc --noEmit` clean
- All pushed to GitHub

### Next session: generate API keys, run the app for the first time, verify mock → real responses

### To run the app right now (mock mode, no keys needed):
```
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
cd client && npm run dev
# Open http://localhost:5173
```
