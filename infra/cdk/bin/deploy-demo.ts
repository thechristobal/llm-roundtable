#!/usr/bin/env node
// Deploy the ephemeral demo-api stack with a computed ExpiryIsoAt.
//
// Usage:
//   node --import tsx/esm bin/deploy-demo.ts [--days N] [--stack-name NAME]
//   pnpm deploy-demo -- --days 7
//
// Flags:
//   --days N          Hours until auto-teardown (default: 7)
//   --stack-name N    Override stack name (default: RoundtableDemoApi)
//   --skip-client     Skip the hosted client rebuild
//
// What this does:
//   1. (unless --skip-client) runs `pnpm build:hosted` in ../../client so the
//      Permanent stack's BucketDeployment picks up the latest bundle.
//   2. Computes ExpiryIsoAt = now + days (UTC, floored to the second — CFN
//      validates ISO8601 and chokes on milliseconds).
//   3. Invokes `cdk deploy <stack> --parameters ExpiryIsoAt=...` with the
//      remaining CLI args passed through, so you can still add --profile,
//      --require-approval=never, --parameters ReservedConcurrency=2, etc.
//
// The permanent stack is NOT touched. Deploy that once with
// `pnpm deploy:permanent` and populate the Turnstile secret per README.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CDK_ROOT = join(__dirname, '..')
const CLIENT_ROOT = join(__dirname, '..', '..', '..', 'client')

interface ParsedArgs {
  days: number
  stackName: string
  deployProfile: 'prod' | 'dev'
  skipClient: boolean
  passthrough: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  let days = 7
  let stackName: string | undefined
  let deployProfile: 'prod' | 'dev' = 'prod'
  let skipClient = false
  const passthrough: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--days') {
      const next = argv[++i]
      if (!next || Number.isNaN(Number(next))) throw new Error('--days requires an integer')
      days = Number(next)
    } else if (arg === '--stack-name') {
      const next = argv[++i]
      if (!next) throw new Error('--stack-name requires a value')
      stackName = next
    } else if (arg === '--dev') {
      deployProfile = 'dev'
    } else if (arg === '--skip-client') {
      skipClient = true
    } else {
      passthrough.push(arg)
    }
  }

  if (days < 1 || days > 90) throw new Error(`--days out of range (1..90): ${days}`)

  // Default stack name tracks the deploy profile so the teardown Lambda's IAM
  // scope matches the stack it will actually delete.
  if (!stackName) {
    stackName = deployProfile === 'dev' ? 'Roundtable-DemoApi-Dev' : 'RoundtableDemoApi'
  }
  return { days, stackName, deployProfile, skipClient, passthrough }
}

function isoAtDaysFromNow(days: number): string {
  const now = Date.now()
  const future = new Date(now + days * 86400_000)
  // CloudFormation validates ExpiryIsoAt as "YYYY-MM-DDTHH:MM:SS" (no ms, no tz suffix).
  // Trim both.
  return future.toISOString().replace(/\.\d{3}Z$/, '')
}

function run(cmd: string, args: string[], cwd: string): void {
  const label = `${cmd} ${args.join(' ')} (cwd=${cwd})`
  console.log(`\n→ ${label}`)
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${label}`)
  }
}

function main(): void {
  const { days, stackName, deployProfile, skipClient, passthrough } = parseArgs(process.argv.slice(2))
  const expiryIsoAt = isoAtDaysFromNow(days)

  console.log(`== Roundtable deploy-demo ==`)
  console.log(`  profile: ${deployProfile}`)
  console.log(`  stack:   ${stackName}`)
  console.log(`  days:    ${days}`)
  console.log(`  teardownAt (UTC): ${expiryIsoAt}`)

  if (!skipClient) {
    const packageManager = process.env.ROUNDTABLE_PM ?? 'pnpm'
    run(packageManager, ['build:hosted'], CLIENT_ROOT)
  }

  run(
    'npx',
    [
      'cdk',
      'deploy',
      stackName,
      '--context',
      `deployProfile=${deployProfile}`,
      '--parameters',
      `ExpiryIsoAt=${expiryIsoAt}`,
      ...passthrough,
    ],
    CDK_ROOT,
  )
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
