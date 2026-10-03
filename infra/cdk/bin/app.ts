#!/usr/bin/env node
import 'source-map-support/register.js'
import { App, Aspects } from 'aws-cdk-lib'
import { PermanentStack, PERMANENT_EXPORTS } from '../lib/permanent-stack.js'
import { DemoApiStack } from '../lib/demo-api-stack.js'
import { CachePolicySanity } from '../lib/assert-cache-policy-sanity.js'

const app = new App()

// Deployment profile: `prod` (default) uses canonical names. `dev` prefixes
// everything with Roundtable-*-Dev for the acceptance test environment. Both
// profiles synth into the same CDK app so cross-stack references resolve
// locally; the CLI selects which stacks to actually deploy.
const profile = app.node.tryGetContext('deployProfile') ?? 'prod'
const isDev = profile === 'dev'

const PERMANENT_STACK_NAME = isDev ? 'Roundtable-Permanent-Dev' : 'RoundtablePermanent'
const DEMO_API_STACK_NAME = isDev ? 'Roundtable-DemoApi-Dev' : 'RoundtableDemoApi'
// Secret paths are also namespaced so dev and prod don't collide in SSM.
const SECRET_PREFIX = isDev ? '/roundtable/demo-dev' : '/roundtable/demo'
const JWT_SECRET_NAME = `${SECRET_PREFIX}/jwt-secret`
const IP_HASH_SECRET_NAME = `${SECRET_PREFIX}/ip-hash-secret`
const TURNSTILE_SECRET_NAME = `${SECRET_PREFIX}/turnstile-secret`

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
}

const permanent = new PermanentStack(app, PERMANENT_STACK_NAME, {
  env,
  demoApiStackName: DEMO_API_STACK_NAME,
  jwtSecretName: JWT_SECRET_NAME,
  ipHashSecretName: IP_HASH_SECRET_NAME,
  turnstileSecretName: TURNSTILE_SECRET_NAME,
  alarmEmail: app.node.tryGetContext('alarmEmail'),
})

Aspects.of(app).add(new CachePolicySanity())

new DemoApiStack(app, DEMO_API_STACK_NAME, {
  env,
  distributionId: permanent.distribution.distributionId,
  placeholderOriginId: PERMANENT_EXPORTS.placeholderOriginId,
  placeholderOriginDomain: PERMANENT_EXPORTS.placeholderOriginDomain,
  placeholderOriginPath: '',
  statusWriterFn: permanent.statusWriterFn,
  alarmTopic: permanent.alarmTopic,
  jwtSecretName: JWT_SECRET_NAME,
  ipHashSecretName: IP_HASH_SECRET_NAME,
  turnstileSecretName: TURNSTILE_SECRET_NAME,
})
