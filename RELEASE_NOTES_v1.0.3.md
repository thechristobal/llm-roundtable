# Roundtable v1.0.3 — Windows

Security-hardening release. No new user-facing features; every change closes a runtime attack surface surfaced by a source-only security audit. Install this over v1.0.2 the same way (or wait for the updater — that path also got a confirmation dialog in this build).

## What's hardened

- **Local server bound to loopback only.** The embedded HTTP server that the renderer talks to now listens on `127.0.0.1` instead of `0.0.0.0`. Anything on your LAN can no longer reach it.
- **Bearer-token auth on `/api/*`.** Every launch generates a fresh 32-byte random token, kept in memory only (never written to disk, never exported, never logged). The renderer attaches it to every request; anything without it gets 401. Constant-time comparison, so no timing side-channel.
- **CORS locked down.** Only `file://` and `localhost` origins are reflected. A web page you happen to have open cannot POST to the local server.
- **XSS sinks in the fabrication highlighter and exported HTML.** The Jev fabrication highlighter no longer re-parses model output as HTML (removed `rehype-raw`). Exported `.html` files now escape every user- and model-supplied string, and neutralize `</script>` inside the embedded data blob — so an LLM response can't break out of the export container when someone opens the file.
- **Auto-updater asks first.** v1.0.2 would swap the binary at next quit without asking. v1.0.3 pops a dialog with Install Now / Install on Quit / Skip.
- **Electron 33 → 39.8.10.** Picks up the fix for a context-isolation bypass (GHSA-vmqv-hx8q-j7mg) and several months of upstream patches. Node 20 compatibility retained.
- **Narrower error surface from the Claude Code CLI adapter.** No longer echoes full stderr into error strings.

## Install (fresh)

Download `llm-roundtable-1.0.3 Setup.exe`, run it, click through the unsigned-installer SmartScreen warning. Full setup notes are in the [README](https://github.com/thechristobal/llm-roundtable/blob/main/README.md).

## Install (from v1.0.2)

The updater in v1.0.2 will detect this release at next launch and prompt you. Old behavior would have swapped silently on next quit; new behavior asks first.

## Known limitations

- Windows only.
- No code signing; SmartScreen still warns on first-time install.
- Auto-updater only checks at launch (not on a background timer).
