# Roundtable v1.0.1 — Windows

Small but meaningful pass. If you already have v1.0.0 installed, this build will land automatically the next time you restart the app — no need to download manually.

## What's new

- **Auto-updater wired up.** Uses Electron's built-in Squirrel updater against `update.electronjs.org`, which fronts this repo's Releases. Updates check silently at launch, download in the background, and apply on your next natural app quit. No restart dialog, no notification pop-ups.
- **Cross-model LaTeX rendering fixed.** Gemini (and the others intermittently) emit standard `$...$` inline math; the v1.0.0 renderer dropped it as literal text. Now `$E^*$`, `\(x^2\)`, `\[y=z\]`, and `$$…$$` all render correctly via KaTeX. Currency ranges like `$100-$200` are still preserved as text.
- **System prompts realigned** — the previous instruction "use `$$` for inline math" was fighting all three models' training. Now they're told to use the standard LaTeX convention they already know.

## Install (fresh)

Same as v1.0.0. Download `llm-roundtable-1.0.1 Setup.exe`, run it, click through the unsigned-installer SmartScreen warning. Full setup notes are in the [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md).

## Known limitations

- Windows only.
- No code signing; SmartScreen still warns on first-time install.
- Auto-updater only runs on packaged builds and only checks at launch (not on a background timer).
