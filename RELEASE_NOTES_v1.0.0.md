# Roundtable v1.0.0 — Windows

First public build. A desktop app that runs a three-way debate between ChatGPT, Claude, and Gemini, then scores each round with Jev (TypeSafe's evaluator model).

## Install

1. Download `llm-roundtable-1.0.0 Setup.exe` below.
2. Run it. Windows SmartScreen will warn "unrecognized app" because the binary is unsigned — click **More info → Run anyway**. (Code signing is on the backlog; see README.)
3. Squirrel installs into `%LocalAppData%\llm_roundtable` and creates a Start Menu shortcut.

## Set up providers

Open the app → **Settings**. You need at least one debater connected:

- **ChatGPT** — sign in to your ChatGPT account (uses your existing Codex/ChatGPT session)
- **Claude** — install Claude Code and sign in with your Anthropic account from the CLI (`claude auth login` on current versions), OR paste an Anthropic API key
- **Gemini** — paste a Google AI Studio key ([aistudio.google.com](https://aistudio.google.com))
- **Jev** (optional referee) — paste a TypeSafe API key. Without one, Jev runs in demo mode with fixed scores.

Keys are stored encrypted via Windows DPAPI (`safeStorage`) in `%AppData%\llm-roundtable\provider-keys.json` and never leave your machine except to hit the provider's own API.

## What's in it

- Round-by-round debate loop between three frontier models
- Jev scorecard per round: Reasoning, Intellectual Honesty, Precision, Coherence, plus a Task Adherence **hard gate** (a response that fails adherence is disqualified for the round regardless of dimension scores)
- Fabrication and contradiction flags on scorecard entries
- Graceful per-provider failure (Gemini quota exhaustion won't take down the round)
- User picks a winner alongside Jev's verdict

See [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md) for architecture notes.

## Known limitations

- Windows only (Squirrel installer). macOS/Linux builds not published.
- No auto-updater wired up — future releases will need a manual reinstall.
- No code signing; SmartScreen warning is expected.
- AWS backend from the original design isn't implemented — everything runs local + provider APIs.
