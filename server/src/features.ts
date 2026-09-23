// Kill switch: set ROUNDTABLE_DISABLE_CLAUDE_CLI=1 in the Electron main env
// and re-release to force all Anthropic requests through the API-key path.
export const CLAUDE_CLI_ENABLED = process.env.ROUNDTABLE_DISABLE_CLAUDE_CLI !== '1'
