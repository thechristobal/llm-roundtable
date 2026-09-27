# Roundtable — Changelog

Per-release notes for [thechristobal/llm-roundtable](https://github.com/thechristobal/llm-roundtable). The GitHub Releases page is the primary distribution surface; this file is the source of truth for release-note prose. To publish a new release, extract the relevant section below (see [Publishing a release](#publishing-a-release)) and hand it to `gh release create -F`.

---

## v1.0.2 — Windows — 2026-09-25

Tiny release. Its main job is to prove the v1.0.1 auto-updater actually works end-to-end: install v1.0.1, restart, and this build should quietly replace it. Nothing to download manually.

### What's new

- **App version now shown in Settings.** Small `Roundtable v1.0.2` label in the top-right of the Settings pane — a visible way to confirm which build is running after the updater fires.

### Install (fresh)

Same as prior releases. Download `llm-roundtable-1.0.2 Setup.exe`, run it, click through the unsigned-installer SmartScreen warning. Full setup notes are in the [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md).

### Known limitations

- Windows only.
- No code signing; SmartScreen still warns on first-time install.
- Auto-updater only runs on packaged builds and only checks at launch (not on a background timer).

---

## v1.0.1 — Windows — 2026-09-24

Small but meaningful pass. If you already have v1.0.0 installed, this build will land automatically the next time you restart the app — no need to download manually.

### What's new

- **Auto-updater wired up.** Uses Electron's built-in Squirrel updater against `update.electronjs.org`, which fronts this repo's Releases. Updates check silently at launch, download in the background, and apply on your next natural app quit. No restart dialog, no notification pop-ups.
- **Cross-model LaTeX rendering fixed.** Gemini (and the others intermittently) emit standard `$...$` inline math; the v1.0.0 renderer dropped it as literal text. Now `$E^*$`, `\(x^2\)`, `\[y=z\]`, and `$$…$$` all render correctly via KaTeX. Currency ranges like `$100-$200` are still preserved as text.
- **System prompts realigned** — the previous instruction "use `$$` for inline math" was fighting all three models' training. Now they're told to use the standard LaTeX convention they already know.

### Install (fresh)

Same as v1.0.0. Download `llm-roundtable-1.0.1 Setup.exe`, run it, click through the unsigned-installer SmartScreen warning. Full setup notes are in the [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md).

### Known limitations

- Windows only.
- No code signing; SmartScreen still warns on first-time install.
- Auto-updater only runs on packaged builds and only checks at launch (not on a background timer).

---

## v1.0.0 — Windows — 2026-09-23

First public build. A desktop app that runs a three-way debate between ChatGPT, Claude, and Gemini, then scores each round with Jev (TypeSafe's evaluator model).

### Install

1. Download `llm-roundtable-1.0.0 Setup.exe` below.
2. Run it. Windows SmartScreen will warn "unrecognized app" because the binary is unsigned — click **More info → Run anyway**. (Code signing is on the backlog; see README.)
3. Squirrel installs into `%LocalAppData%\llm_roundtable` and creates a Start Menu shortcut.

### Set up providers

Open the app → **Settings**. You need at least one debater connected:

- **ChatGPT** — sign in to your ChatGPT account (uses your existing Codex/ChatGPT session)
- **Claude** — install Claude Code and sign in with your Anthropic account from the CLI (`claude auth login` on current versions), OR paste an Anthropic API key
- **Gemini** — paste a Google AI Studio key ([aistudio.google.com](https://aistudio.google.com))
- **Jev** (optional referee) — paste a TypeSafe API key. Without one, Jev runs in demo mode with fixed scores.

Keys are stored encrypted via Windows DPAPI (`safeStorage`) in `%AppData%\llm-roundtable\provider-keys.json` and never leave your machine except to hit the provider's own API.

### What's in it

- Round-by-round debate loop between three frontier models
- Jev scorecard per round: Reasoning, Intellectual Honesty, Precision, Coherence, plus a Task Adherence **hard gate** (a response that fails adherence is disqualified for the round regardless of dimension scores)
- Fabrication and contradiction flags on scorecard entries
- Graceful per-provider failure (Gemini quota exhaustion won't take down the round)
- User picks a winner alongside Jev's verdict

See [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md) for architecture notes.

### Known limitations

- Windows only (Squirrel installer). macOS/Linux builds not published.
- No auto-updater wired up — future releases will need a manual reinstall.
- No code signing; SmartScreen warning is expected.
- AWS backend from the original design isn't implemented — everything runs local + provider APIs.

---

## Publishing a release

The rule: never round-trip release-note bytes through a shell variable — Windows PowerShell 5.1 decodes UTF-8 files as CP1252 by default and will double-encode em-dashes into `â€"` on the release page. This has happened once (v1.0.0–v1.0.2, fixed retroactively). Read the file as raw bytes:

**Extract a section:** (targets the exact version — start at its `## ` header, stop at the next `## ` header)

```bash
# Bash / Git Bash / macOS / Linux
awk '/^## v1\.0\.3 /{f=1; print; next} /^## / && f{exit} f' CHANGELOG.md > /tmp/notes.md
```

**Publish:**

```bash
gh release create v1.0.3 -t "Roundtable v1.0.3" -F /tmp/notes.md <artifact paths>
```

**Verify** (GitHub CDN can serve a stale response for ~30s; fetch fresh and grep for mojibake):

```bash
curl -s https://api.github.com/repos/thechristobal/llm-roundtable/releases/tags/v1.0.3 \
  | python -c "import sys,json; b=json.load(sys.stdin)['body']; assert chr(0xE2) not in b and chr(0xC3) not in b, 'MOJIBAKE'; print('clean')"
```
