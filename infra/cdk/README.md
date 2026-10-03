# Roundtable Hosted Demo — Deploy / Teardown / Re-enable

Operator runbook for the AWS-hosted Vynyl demo. Two CDK stacks:

- **`RoundtablePermanent`** — static client (S3 + CloudFront), SNS alarm topic, status-writer Lambda, teardown Lambda, Turnstile SSM param, CloudFront `/api/*` placeholder origin. Lives for the full 60-90 day window.
- **`RoundtableDemoApi`** — API Gateway REST + three Lambdas (`debate-stream` with streaming invoke mode, `token-mint`, `health`), DynamoDB rate-limit table, SecretRotator CR, CfOriginBinder CR, StatusWriter CR, EventBridge Scheduler teardown. Spun up per demo window.

Everything downstream of CloudFront `/api/*` is in the ephemeral stack. Teardown rebinds `/api/*` back to the placeholder origin, so the static client stays live and `status.json` surfaces an authoritative "demo unavailable" signal.

---

## One-time prerequisites

1. `aws configure sso` — operator credentials with CDK bootstrap privileges in the target account/region.
2. CDK bootstrap: `cd infra/cdk && npx cdk bootstrap aws://<account>/<region>`.
3. Build the client once so `client/dist/` exists (BucketDeployment reads from there):
   ```
   cd client && pnpm build
   ```

---

## First deploy of the permanent stack

```
cd infra/cdk
pnpm install
pnpm deploy:permanent -- --context alarmEmail=you@example.com
```

Then, in the AWS SSM console, set the Turnstile server secret:
```
Parameter: /roundtable/demo/turnstile-secret
Type:      SecureString
Value:     <paste Cloudflare Turnstile secret>
```
(The CDK deploys a placeholder; `token-mint` fails fast until this is set.)

Outputs to capture: `DistributionId`, `DistributionDomain`, `StatusWriterFnArn`, `TeardownFnArn`.

---

## Deploy an ephemeral demo window

Easiest path — the `deploy-demo` helper computes the teardown timestamp and rebuilds the hosted client bundle before invoking CDK:

```
cd infra/cdk
pnpm deploy-demo -- --days 7
# → runs `pnpm build:hosted` in client/
# → computes ExpiryIsoAt = now + 7 days (UTC, no ms)
# → cdk deploy RoundtableDemoApi --parameters ExpiryIsoAt=...
```

Flags: `--days N` (1..90, default 7), `--stack-name NAME` (default `RoundtableDemoApi`), `--skip-client`. Any remaining args pass straight through to `cdk deploy` (e.g. `--profile ops-prod --parameters ReservedConcurrency=2`).

Prereq: build the hosted client at least once with `pnpm build:hosted` in `client/`, with a `.env.hosted` containing `VITE_HOSTED_MODE=true` and `VITE_TURNSTILE_SITEKEY=<cloudflare sitekey>` (see `client/.env.hosted.example`).

Manual equivalent:

```
# Compute the UTC ISO8601 teardown datetime (7 days from now, example):
EXPIRY=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%S)

cd infra/cdk
pnpm deploy:demo-api -- \
  --parameters ExpiryDays=7 \
  --parameters ReservedConcurrency=1 \
  --parameters ExpiryIsoAt="$EXPIRY"
```

What happens on CREATE:

1. CFN creates the DynamoDB table, three Lambdas, API Gateway.
2. `SecretRotator` CR generates `jwtSecret` + `ipHashSecret` SSM SecureStrings (idempotent — won't regenerate if they already exist).
3. `CfOriginBinder` CR fetches the live CloudFront `DistributionConfig`, swaps the `/api/*` origin from the placeholder to the fresh REST endpoint using `IfMatch: <ETag>`, then polls `GetDistribution.Status` until `Deployed`. This takes 5-15 min — this is **deployment-only Step Functions plumbing** that the `@aws-cdk/custom-resources` Provider framework stands up for `isCompleteHandler`, not debate orchestration.
4. `StatusWriter` CR writes `status.json: { available: true, expiresAt: '7d' }` to the permanent status bucket.
5. EventBridge Scheduler is armed with a one-shot invocation at `ExpiryIsoAt` targeting the permanent `teardownFn`.

---

## Scheduled teardown

At `ExpiryIsoAt`, EventBridge fires `teardownFn`, which calls `DeleteStack` on `RoundtableDemoApi`. CFN deletion order:

1. `StatusWriter` CR DELETE → writes `status.json: { available: false, reason: 'teardown' }`.
2. `CfOriginBinder` CR DELETE → fetches `DistributionConfig`, swaps `/api/*` back to the placeholder origin, polls for `Status=Deployed`. **The API Gateway + Lambdas stay alive until this returns** because the custom resource owns the dependency.
3. API Gateway, Lambdas, DynamoDB, SSM secrets, EventBridge schedule all deleted.

The permanent stack is untouched. Static client keeps serving. `/api/*` requests return 502/503/504 → CloudFront serves `/unavailable.html` ("demo unavailable", not "demo offline" — live-origin failures land here too). The client UI distinguishes intentional offline via `status.json`.

---

## Re-enable a torn-down demo

Just redeploy the ephemeral stack with a new `ExpiryIsoAt`:
```
EXPIRY=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%S)
pnpm deploy:demo-api -- --parameters ExpiryIsoAt="$EXPIRY"
```

The `SecretRotator` CR reads the existing `jwtSecret` + `ipHashSecret` (preserved across deploys) and leaves them alone. Only an explicit SSM `DeleteParameter` or stack destroy regenerates them.

---

## Manual force-teardown

```
cd infra/cdk
pnpm destroy:demo-api
```

Same ordering as scheduled teardown.

---

## Alarms

SNS topic `RoundtablePermanent-AlarmTopic` fans out to the email set at first deploy. Alarms:
- `${demo-api}-Debate-errors` / `-Token-errors` — ≥ 5 errors / 5 min
- `${demo-api}-Debate-throttles` / `-Token-throttles` — ≥ 10 throttles / 5 min
- `${demo-api}-ddb-throttles` — ≥ 20 throttled `UpdateItem` / 5 min

Add CPU/memory or custom metrics later as needed.

---

## Known gotchas

- **CloudFront propagation**: every `CfOriginBinder` CRUD waits 5-15 min for `Status=Deployed`. Set a chunk of time aside for first ephemeral deploy and for scheduled teardown.
- **Node runtime**: all Lambdas pinned to `NODEJS_22_X` today because `aws-cdk-lib` hasn't exposed `NODEJS_24_X` enum yet (Node 24 is already deprecated per architecture plan — bump via `addPropertyOverride` or wait for the CDK version that ships it; search for `NODEJS_22_X` in `infra/cdk/lib/`).
- **Debate function URL**: `debate-stream` has a Function URL in `RESPONSE_STREAM` invoke mode because API Gateway REST + Lambda proxy historically truncated at the 29s hard cap. API Gateway REST added `ResponseTransferMode=STREAM` in Nov 2025 — we wire the method with `addPropertyOverride('Integration.ResponseTransferMode', 'STREAM')`. If the request still buffers, re-check that this CFN override made it into the deployed template.
- **Turnstile secret**: `token-mint` throws on every request until the SSM param is populated. Set it manually once, after the permanent stack is up.
