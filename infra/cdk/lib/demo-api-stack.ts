// Ephemeral demo-api stack — spun up for each hosted demo window, torn down
// by the EventBridge Scheduler + teardownFn at ExpiryDays.
//
// Owns:
//   - 3 Lambdas (debate-stream w/ ResponseStream=STREAM, token-mint, health)
//   - DynamoDB rate-limit table (session + IP token buckets, TTL)
//   - API Gateway REST API, Regional endpoint, /debate /token /health routes
//   - secretRotator custom resource (sole owner of jwtSecret + ipHashSecret)
//   - cfOriginBinder custom resource (binds /api/* to this REST endpoint)
//   - statusWriter CRs for CREATE (available:true) and DELETE (available:false)
//   - EventBridge Scheduler one-shot invocation at ExpiryDays - 5min that
//     flips status.json to available:false; teardownFn fires at ExpiryDays.
//   - CloudWatch alarms wired to the permanent alarm topic.
import {
  Duration,
  RemovalPolicy,
  Stack,
  CfnParameter,
  CfnOutput,
  type StackProps,
  aws_apigateway as apigw,
  aws_dynamodb as ddb,
  aws_iam as iam,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwa,
  aws_scheduler as scheduler,
} from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Runtime, Architecture, FunctionUrlAuthType, InvokeMode } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import type { ITopic } from 'aws-cdk-lib/aws-sns'
import type { IFunction } from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CfOriginBinder } from './constructs/cf-origin-binder.js'
import { SecretRotatorCr } from './constructs/secret-rotator-cr.js'
import { StatusWriterCr } from './constructs/status-writer-cr.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const AWS_LAMBDA_ROOT = join(__dirname, '..', '..', '..', 'aws-lambda')
const LAMBDA_SOURCES = join(AWS_LAMBDA_ROOT, 'src', 'handlers')
const AWS_LAMBDA_LOCK = join(AWS_LAMBDA_ROOT, 'package-lock.json')

export interface DemoApiStackProps extends StackProps {
  distributionId: string
  placeholderOriginId: string
  placeholderOriginDomain: string
  placeholderOriginPath: string
  statusWriterFn: IFunction
  alarmTopic: ITopic
  jwtSecretName: string
  ipHashSecretName: string
  turnstileSecretName: string
}

// Scoped logging policy that replaces the AWSLambdaBasicExecutionRole
// wildcard. Scoped to a specific log group ARN.
function logGroupPolicy(region: string, account: string, logGroupName: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    resources: [`arn:aws:logs:${region}:${account}:log-group:${logGroupName}:*`],
  })
}

export class DemoApiStack extends Stack {
  constructor(scope: Construct, id: string, props: DemoApiStackProps) {
    super(scope, id, props)

    const expiryDays = new CfnParameter(this, 'ExpiryDays', {
      type: 'Number',
      default: 7,
      minValue: 1,
      maxValue: 30,
      description: 'Days until the demo-api stack self-destructs (via EventBridge Scheduler → teardownFn).',
    })
    const reservedConcurrency = new CfnParameter(this, 'ReservedConcurrency', {
      type: 'Number',
      default: 1,
      minValue: 1,
      maxValue: 10,
      description: 'Per-Lambda reserved concurrency; cost ceiling knob.',
    })

    // ------------------------------------------------------------------
    // SECRETS — secretRotator is the sole owner. No AWS::SSM::Parameter
    // declared here for jwtSecret / ipHashSecret.
    // ------------------------------------------------------------------
    new SecretRotatorCr(this, 'SecretRotator', {
      jwtSecretName: props.jwtSecretName,
      ipHashSecretName: props.ipHashSecretName,
      region: this.region,
      account: this.account,
    })

    const jwtSecretArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${props.jwtSecretName}`
    const ipHashSecretArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${props.ipHashSecretName}`
    const turnstileSecretArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${props.turnstileSecretName}`

    // ------------------------------------------------------------------
    // RATE LIMIT TABLE — pay-per-request, TTL-swept token buckets.
    // ------------------------------------------------------------------
    const rateLimitTable = new ddb.Table(this, 'RateLimitTable', {
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // ------------------------------------------------------------------
    // LAMBDAS
    // ------------------------------------------------------------------
    const commonEnv = {
      JWT_SECRET_PARAM: props.jwtSecretName,
      IP_HASH_SECRET_PARAM: props.ipHashSecretName,
      TURNSTILE_SECRET_PARAM: props.turnstileSecretName,
      RATE_LIMIT_TABLE: rateLimitTable.tableName,
      ROUNDTABLE_PROFILE: 'demo',
    }

    const debateLogGroupName = `/aws/lambda/${id}-debate-stream`
    const debateLogs = new LogGroup(this, 'DebateLogs', {
      logGroupName: debateLogGroupName,
      retention: RetentionDays.ONE_WEEK,
    })
    const debateFn = new NodejsFunction(this, 'DebateFn', {
      entry: join(LAMBDA_SOURCES, 'debate-stream.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(120),
      memorySize: 1024,
      reservedConcurrentExecutions: reservedConcurrency.valueAsNumber,
      logGroup: debateLogs,
      environment: commonEnv,
      depsLockFilePath: AWS_LAMBDA_LOCK,
      projectRoot: AWS_LAMBDA_ROOT,
      bundling: {
        format: 'esm' as unknown as never, // aws-cdk-lib types lag the enum; esm is correct
        target: 'node22',
      },
      initialPolicy: [
        logGroupPolicy(this.region, this.account, debateLogGroupName),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: [jwtSecretArn, ipHashSecretArn],
        }),
      ],
    })
    rateLimitTable.grantReadWriteData(debateFn)

    const tokenLogGroupName = `/aws/lambda/${id}-token-mint`
    const tokenLogs = new LogGroup(this, 'TokenLogs', {
      logGroupName: tokenLogGroupName,
      retention: RetentionDays.ONE_WEEK,
    })
    const tokenFn = new NodejsFunction(this, 'TokenFn', {
      entry: join(LAMBDA_SOURCES, 'token-mint.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(10),
      memorySize: 512,
      reservedConcurrentExecutions: reservedConcurrency.valueAsNumber,
      logGroup: tokenLogs,
      environment: commonEnv,
      depsLockFilePath: AWS_LAMBDA_LOCK,
      projectRoot: AWS_LAMBDA_ROOT,
      initialPolicy: [
        logGroupPolicy(this.region, this.account, tokenLogGroupName),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: [jwtSecretArn, turnstileSecretArn],
        }),
      ],
    })

    const healthLogGroupName = `/aws/lambda/${id}-health`
    const healthLogs = new LogGroup(this, 'HealthLogs', {
      logGroupName: healthLogGroupName,
      retention: RetentionDays.ONE_WEEK,
    })
    const healthFn = new NodejsFunction(this, 'HealthFn', {
      entry: join(LAMBDA_SOURCES, 'health.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(5),
      memorySize: 128,
      reservedConcurrentExecutions: reservedConcurrency.valueAsNumber,
      logGroup: healthLogs,
      depsLockFilePath: AWS_LAMBDA_LOCK,
      projectRoot: AWS_LAMBDA_ROOT,
      initialPolicy: [logGroupPolicy(this.region, this.account, healthLogGroupName)],
    })

    // Debate function gets a Function URL in STREAM mode so API Gateway REST
    // can proxy to it with ResponseTransferMode=STREAM. (Nov 2025 feature.)
    const debateFnUrl = debateFn.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    })

    // ------------------------------------------------------------------
    // REST API — Regional endpoint, same-origin via CloudFront /api/*.
    // ------------------------------------------------------------------
    const api = new apigw.RestApi(this, 'Api', {
      restApiName: `roundtable-demo-${id}`,
      endpointConfiguration: { types: [apigw.EndpointType.REGIONAL] },
      deployOptions: { stageName: 'prod', loggingLevel: apigw.MethodLoggingLevel.ERROR },
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:5173'],
        allowMethods: ['POST', 'GET', 'OPTIONS'],
        allowHeaders: [
          'content-type', 'authorization',
          'x-openai-key', 'x-anthropic-key', 'x-google-key', 'x-typesafe-key',
        ],
        allowCredentials: false,
      },
    })

    // /health
    api.root.addResource('health').addMethod('GET', new apigw.LambdaIntegration(healthFn))

    // /token
    api.root.addResource('token').addMethod('POST', new apigw.LambdaIntegration(tokenFn))

    // /debate — HTTP_PROXY to the Function URL with STREAM transfer. API GW
    // REST exposes ResponseTransferMode as an integration-level property;
    // CDK doesn't model it directly yet, so we drop to CfnMethod overrides.
    const debate = api.root.addResource('debate')
    const debateMethod = debate.addMethod('POST', new apigw.HttpIntegration(debateFnUrl.url, {
      httpMethod: 'POST',
      proxy: true,
      options: {
        integrationResponses: [{ statusCode: '200' }],
        connectionType: apigw.ConnectionType.INTERNET,
      },
    }), {
      methodResponses: [{ statusCode: '200' }],
    })
    const cfnMethod = debateMethod.node.defaultChild as apigw.CfnMethod
    cfnMethod.addPropertyOverride('Integration.ResponseTransferMode', 'STREAM')

    // ------------------------------------------------------------------
    // CF ORIGIN BINDER — bind /api/* to this REST endpoint on CREATE,
    // reverse on DELETE. Deletion ordering: the custom resource holds
    // the API alive until CloudFront propagation back to placeholder
    // completes (isCompleteHandler waits for Status=Deployed).
    // ------------------------------------------------------------------
    const apiOriginDomain = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`
    const apiOriginPath = `/${api.deploymentStage.stageName}`
    const cfBinder = new CfOriginBinder(this, 'CfOriginBinder', {
      distributionId: props.distributionId,
      apiOriginId: props.placeholderOriginId,
      apiOriginDomain,
      apiOriginPath,
      placeholderOriginDomain: props.placeholderOriginDomain,
      placeholderOriginPath: props.placeholderOriginPath,
    })
    cfBinder.resource.node.addDependency(api.deploymentStage)

    // ------------------------------------------------------------------
    // STATUS WRITER CRs — flip status.json on CREATE and DELETE.
    // ------------------------------------------------------------------
    const expiresAt = `${expiryDays.valueAsNumber}d`
    const statusCreate = new StatusWriterCr(this, 'StatusCreate', {
      statusWriterFn: props.statusWriterFn,
      scope: 'available',
      expiresAt,
    })
    statusCreate.resource.node.addDependency(cfBinder.resource)

    // ------------------------------------------------------------------
    // EVENTBRIDGE SCHEDULER — one-shot teardown trigger at ExpiryDays.
    // ------------------------------------------------------------------
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    })
    // CDK context tokens can't do date math at synth time; the actual
    // scheduled datetime is computed by `scripts/deploy-demo.sh` and
    // passed in as a stack parameter. For now, declare the schedule
    // without a concrete time — operator script fills it in.
    const expiryIso = new CfnParameter(this, 'ExpiryIsoAt', {
      type: 'String',
      default: '',
      description: 'UTC ISO8601 teardown datetime. Set by scripts/deploy-demo.sh.',
    })

    const teardownFnArn = `arn:aws:lambda:${this.region}:${this.account}:function:roundtable-teardown`
    const teardownScheduler = new scheduler.CfnSchedule(this, 'TeardownSchedule', {
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: `at(${expiryIso.valueAsString})`,
      target: {
        arn: teardownFnArn,
        roleArn: schedulerRole.roleArn,
      },
    })
    schedulerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [teardownFnArn],
    }))
    teardownScheduler.node.addDependency(schedulerRole)

    // ------------------------------------------------------------------
    // ALARMS — error rate on debate+token functions, DynamoDB throttles.
    // ------------------------------------------------------------------
    for (const [name, fn] of [['Debate', debateFn], ['Token', tokenFn]] as const) {
      new cw.Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `${id}-${name}-errors`,
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      }).addAlarmAction(new cwa.SnsAction(props.alarmTopic))

      new cw.Alarm(this, `${name}ThrottleAlarm`, {
        alarmName: `${id}-${name}-throttles`,
        metric: fn.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 10,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      }).addAlarmAction(new cwa.SnsAction(props.alarmTopic))
    }

    new cw.Alarm(this, 'DdbThrottleAlarm', {
      alarmName: `${id}-ddb-throttles`,
      metric: rateLimitTable.metricThrottledRequestsForOperations({
        operations: [ddb.Operation.UPDATE_ITEM],
        period: Duration.minutes(5),
      }),
      threshold: 20,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    }).addAlarmAction(new cwa.SnsAction(props.alarmTopic))

    // ------------------------------------------------------------------
    new CfnOutput(this, 'ApiEndpoint', { value: api.url })
    new CfnOutput(this, 'DebateFnUrl', { value: debateFnUrl.url })
  }
}
