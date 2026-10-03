// Rebinds CloudFront's /api/* origin between a placeholder and the live
// demo-api endpoint, waiting for Distribution.Status=Deployed before
// declaring success. This is deployment-only Step Functions plumbing
// (the @aws-cdk/custom-resources Provider framework stands up a small
// waiter state machine for isCompleteHandler); it is NOT part of debate
// orchestration at runtime.
//
// Why not AwsCustomResource? AwsCustomResource is a single SDK call. We
// need Get→Mutate→Update with ETag passing AND Status=Deployed polling,
// which Provider framework expresses cleanly as onEvent + isComplete.
import { Duration, CustomResource } from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
import { Provider } from 'aws-cdk-lib/custom-resources'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const LAMBDA_SOURCES = join(__dirname, '..', '..', 'lambda-sources')

export interface CfOriginBinderProps {
  distributionId: string
  apiOriginId: string
  apiOriginDomain: string
  apiOriginPath: string
  placeholderOriginDomain: string
  placeholderOriginPath: string
}

export class CfOriginBinder extends Construct {
  readonly resource: CustomResource

  constructor(scope: Construct, id: string, props: CfOriginBinderProps) {
    super(scope, id)

    const onEventLogGroup = new LogGroup(this, 'OnEventLogs', {
      logGroupName: `/aws/lambda/${id}-on-event`,
      retention: RetentionDays.ONE_WEEK,
    })
    const isCompleteLogGroup = new LogGroup(this, 'IsCompleteLogs', {
      logGroupName: `/aws/lambda/${id}-is-complete`,
      retention: RetentionDays.ONE_WEEK,
    })

    const cfPermissions = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution'],
      resources: [`arn:aws:cloudfront::*:distribution/${props.distributionId}`],
    })

    const onEvent = new NodejsFunction(this, 'OnEventFn', {
      entry: join(LAMBDA_SOURCES, 'cf-binder-on-event.ts'),
      runtime: Runtime.NODEJS_22_X, // bump to NODEJS_24_X once aws-cdk-lib exposes it
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: onEventLogGroup,
      initialPolicy: [cfPermissions],
    })

    const isComplete = new NodejsFunction(this, 'IsCompleteFn', {
      entry: join(LAMBDA_SOURCES, 'cf-binder-is-complete.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: isCompleteLogGroup,
      initialPolicy: [cfPermissions],
    })

    const provider = new Provider(this, 'Provider', {
      onEventHandler: onEvent,
      isCompleteHandler: isComplete,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.minutes(20),
    })

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        distributionId: props.distributionId,
        apiOriginId: props.apiOriginId,
        apiOriginDomain: props.apiOriginDomain,
        apiOriginPath: props.apiOriginPath,
        placeholderOriginDomain: props.placeholderOriginDomain,
        placeholderOriginPath: props.placeholderOriginPath,
      },
    })
  }
}
