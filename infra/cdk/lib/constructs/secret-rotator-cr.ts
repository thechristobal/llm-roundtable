// Creates jwtSecret + ipHashSecret SecureStrings on stack CREATE, leaves
// them alone on UPDATE, deletes them on DELETE. Sole owner — do NOT also
// declare AWS::SSM::Parameter resources for these two values.
import { CustomResource, Duration } from 'aws-cdk-lib'
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

export interface SecretRotatorCrProps {
  jwtSecretName: string
  ipHashSecretName: string
  region: string
  account: string
}

export class SecretRotatorCr extends Construct {
  readonly resource: CustomResource

  constructor(scope: Construct, id: string, props: SecretRotatorCrProps) {
    super(scope, id)

    const logs = new LogGroup(this, 'Logs', {
      logGroupName: `/aws/lambda/${id}`,
      retention: RetentionDays.ONE_WEEK,
    })

    const secretArns = [
      `arn:aws:ssm:${props.region}:${props.account}:parameter${props.jwtSecretName}`,
      `arn:aws:ssm:${props.region}:${props.account}:parameter${props.ipHashSecretName}`,
    ]

    const fn = new NodejsFunction(this, 'Fn', {
      entry: join(LAMBDA_SOURCES, 'secret-rotator.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: logs,
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
          resources: secretArns,
        }),
      ],
    })

    const provider = new Provider(this, 'Provider', { onEventHandler: fn })

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        jwtSecretName: props.jwtSecretName,
        ipHashSecretName: props.ipHashSecretName,
      },
    })
  }
}
