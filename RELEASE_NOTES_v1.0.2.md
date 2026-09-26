# Roundtable v1.0.2 — Windows

Tiny release. Its main job is to prove the v1.0.1 auto-updater actually works end-to-end: install v1.0.1, restart, and this build should quietly replace it. Nothing to download manually.

## What's new

- **App version now shown in Settings.** Small `Roundtable v1.0.2` label in the top-right of the Settings pane — a visible way to confirm which build is running after the updater fires.

## Install (fresh)

Same as prior releases. Download `llm-roundtable-1.0.2 Setup.exe`, run it, click through the unsigned-installer SmartScreen warning. Full setup notes are in the [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md).

## Known limitations

- Windows only.
- No code signing; SmartScreen still warns on first-time install.
- Auto-updater only runs on packaged builds and only checks at launch (not on a background timer).
