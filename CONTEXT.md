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

- **User-owned API keys** — each user runs the app against their own provider accounts, not the developer's. Important before showing to anyone else.
- **Dynamic panel count + provider/model selection** — dropdown to choose how many panels, which provider each one uses, and which specific model (e.g., run GPT-4o vs GPT-4o-mini side by side, or three different Claude models). Enables running one provider against itself across models.

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

### Next session: Tailwind setup, then App layout and components
