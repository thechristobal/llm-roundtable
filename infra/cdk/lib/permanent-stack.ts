// Permanent stack — lives for the full 60-90 day Vynyl window.
// Owns: static client bucket + CloudFront, SNS alarm topic, long-lived
// Lambdas (status-writer, teardown), the Turnstile secret SSM param,
// and the CloudFront /api/* placeholder origin.
//
// The ephemeral demo-api stack binds its REST endpoint into the /api/*
// origin via the CfOriginBinder custom resource and reverses that bind
// on DELETE.
import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_sns as sns,
  aws_ssm as ssm,
  aws_iam as iam,
  CfnOutput,
} from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const LAMBDA_SOURCES = join(__dirname, '..', 'lambda-sources')
const CLIENT_DIST = join(__dirname, '..', '..', '..', 'client', 'dist')

const PLACEHOLDER_API_ORIGIN_ID = 'ApiOriginPlaceholder'
// Any valid DNS name works; CloudFront only reaches it when the ephemeral
// demo-api stack is torn down and /api/* goes dark anyway.
const PLACEHOLDER_API_ORIGIN_DOMAIN = 'placeholder.invalid'

export interface PermanentStackProps extends StackProps {
  alarmEmail?: string
  demoApiStackName: string
  jwtSecretName: string
  ipHashSecretName: string
  turnstileSecretName: string
}

export class PermanentStack extends Stack {
  readonly clientBucket: s3.Bucket
  readonly statusBucket: s3.Bucket
  readonly distribution: cloudfront.Distribution
  readonly alarmTopic: sns.Topic
  readonly statusWriterFn: NodejsFunction

  constructor(scope: Construct, id: string, props: PermanentStackProps) {
    super(scope, id, props)

    this.clientBucket = new s3.Bucket(this, 'ClientBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
    })

    // Separate bucket for status.json so CloudFront's custom error pages
    // and status.json fetch share the same OAC + lifecycle.
    this.statusBucket = new s3.Bucket(this, 'StatusBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
    })

    const clientOac = new cloudfront.S3OriginAccessControl(this, 'ClientOac')
    const statusOac = new cloudfront.S3OriginAccessControl(this, 'StatusOac')

    const clientOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.clientBucket, { originAccessControl: clientOac })
    const statusOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.statusBucket, { originAccessControl: statusOac })

    // Placeholder HTTP origin for /api/* — the CfOriginBinder custom resource
    // in the ephemeral stack swaps this to the real REST endpoint on CREATE
    // and swaps it back on DELETE.
    const placeholderOrigin = new origins.HttpOrigin(PLACEHOLDER_API_ORIGIN_DOMAIN, {
      originId: PLACEHOLDER_API_ORIGIN_ID,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    })

    // /api/*: effectively no cache. We're pinned between two real constraints:
    //   • CDK L2 refuses `Authorization` in an OriginRequestPolicy allow-list
    //     ("you cannot pass Authorization ... use a CachePolicy to forward
    //     these headers instead"), so Authorization must live on the cache
    //     policy's headerBehavior.
    //   • CloudFront rejects a cache policy that lists any headers / cookies
    //     / query-strings when all three TTLs are 0 ("HeaderBehavior is
    //     invalid for policy with caching disabled").
    // Reconciliation: set MaxTtl/DefaultTtl to 1s so CloudFront considers the
    // policy "enabled". Real traffic is unaffected: /api/debate and /api/token
    // are POST — CloudFront never caches POST responses regardless of TTL.
    // /api/health is a GET but idempotent; a 1s cache window is harmless.
    // Authorization is in the cache key, so no cross-user poisoning.
    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      cachePolicyName: 'roundtable-api-no-cache',
      defaultTtl: Duration.seconds(1),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(1),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('authorization'),
    })
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      originRequestPolicyName: 'roundtable-api-forward-headers',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'x-openai-key',
        'x-anthropic-key',
        'x-google-key',
        'x-typesafe-key',
        'cloudfront-viewer-address',
        'content-type',
      ),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
    })

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: clientOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: placeholderOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: apiCachePolicy,
          originRequestPolicy: apiOriginRequestPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        '/status.json': {
          origin: statusOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, 'StatusCachePolicy', {
            cachePolicyName: 'roundtable-status-short-ttl',
            defaultTtl: Duration.seconds(10),
            minTtl: Duration.seconds(0),
            maxTtl: Duration.seconds(60),
          }),
        },
        '/unavailable.html': {
          origin: statusOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      // 502/503/504 → unavailable.html (NOT "demo offline" — live-origin
      // failures land here too). status.json remains the authoritative
      // intentional-offline signal.
      errorResponses: [
        {
          httpStatus: 502,
          responseHttpStatus: 503,
          responsePagePath: '/unavailable.html',
          ttl: Duration.seconds(10),
        },
        {
          httpStatus: 503,
          responseHttpStatus: 503,
          responsePagePath: '/unavailable.html',
          ttl: Duration.seconds(10),
        },
        {
          httpStatus: 504,
          responseHttpStatus: 503,
          responsePagePath: '/unavailable.html',
          ttl: Duration.seconds(10),
        },
      ],
    })

    new s3deploy.BucketDeployment(this, 'ClientDeployment', {
      destinationBucket: this.clientBucket,
      sources: [s3deploy.Source.asset(CLIENT_DIST)],
      distribution: this.distribution,
      distributionPaths: ['/*'],
    })

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'Roundtable Demo Alarms' })
    if (props.alarmEmail) {
      new sns.Subscription(this, 'AlarmEmailSub', {
        topic: this.alarmTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.alarmEmail,
      })
    }

    // Turnstile secret param — owned here (permanent) so visitors can mint
    // tokens even when the ephemeral demo-api stack is torn down (though
    // mint only lives in demo-api, so this is really just a "pre-exists").
    new ssm.StringParameter(this, 'TurnstileSecret', {
      parameterName: props.turnstileSecretName,
      stringValue: 'PLACEHOLDER_SET_VIA_CONSOLE',
      description: 'Cloudflare Turnstile server secret — set manually via SSM console after deploy',
    })

    const statusWriterLogs = new LogGroup(this, 'StatusWriterLogs', {
      logGroupName: '/aws/lambda/roundtable-status-writer',
      retention: RetentionDays.ONE_WEEK,
    })

    this.statusWriterFn = new NodejsFunction(this, 'StatusWriterFn', {
      entry: join(LAMBDA_SOURCES, 'status-writer.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: statusWriterLogs,
      environment: { STATUS_BUCKET: this.statusBucket.bucketName },
    })
    this.statusBucket.grantPut(this.statusWriterFn, 'status.json')

    const teardownLogs = new LogGroup(this, 'TeardownLogs', {
      logGroupName: '/aws/lambda/roundtable-teardown',
      retention: RetentionDays.ONE_WEEK,
    })

    const teardownFn = new NodejsFunction(this, 'TeardownFn', {
      entry: join(LAMBDA_SOURCES, 'teardown-stack.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(60),
      memorySize: 256,
      logGroup: teardownLogs,
      environment: { DEMO_API_STACK_NAME: props.demoApiStackName },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cloudformation:DescribeStacks', 'cloudformation:DeleteStack'],
          resources: [`arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/${props.demoApiStackName}/*`],
        }),
        // CloudFormation DeleteStack needs permission to delete every
        // resource inside the ephemeral stack; this is granted via a role
        // CFN assumes, not inline. The exact scope lives in that role.
      ],
    })

    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId })
    new CfnOutput(this, 'DistributionDomain', { value: this.distribution.distributionDomainName })
    new CfnOutput(this, 'StatusWriterFnArn', { value: this.statusWriterFn.functionArn })
    new CfnOutput(this, 'TeardownFnArn', { value: teardownFn.functionArn })
    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn })
    new CfnOutput(this, 'PlaceholderApiOriginId', { value: PLACEHOLDER_API_ORIGIN_ID })
    new CfnOutput(this, 'PlaceholderApiOriginDomain', { value: PLACEHOLDER_API_ORIGIN_DOMAIN })
  }
}

export const PERMANENT_EXPORTS = {
  placeholderOriginId: PLACEHOLDER_API_ORIGIN_ID,
  placeholderOriginDomain: PLACEHOLDER_API_ORIGIN_DOMAIN,
} as const
