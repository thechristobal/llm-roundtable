// Writes status.json to the permanent S3 bucket. Shared Lambda is defined
// in the permanent stack; this custom resource invokes it (via Provider
// framework) during ephemeral demo-api CREATE and DELETE to flip the
// available flag.
import { CustomResource } from 'aws-cdk-lib'
import { Provider } from 'aws-cdk-lib/custom-resources'
import type { IFunction } from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'

export interface StatusWriterCrProps {
  statusWriterFn: IFunction
  scope: string
  expiresAt?: string
}

export class StatusWriterCr extends Construct {
  readonly resource: CustomResource

  constructor(scope: Construct, id: string, props: StatusWriterCrProps) {
    super(scope, id)

    const provider = new Provider(this, 'Provider', { onEventHandler: props.statusWriterFn })

    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        scope: props.scope,
        ...(props.expiresAt ? { expiresAt: props.expiresAt } : {}),
      },
    })
  }
}
