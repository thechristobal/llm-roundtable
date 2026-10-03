// EventBridge Scheduler target. Fires once at ExpiryDays - 5min, after
// status-writer has already flipped status.json to {available:false}.
// Deletes the ephemeral demo-api CloudFormation stack; CDK's teardown
// takes it from there (cfOriginBinder DELETE rebinds CloudFront back to
// placeholder, deletes DynamoDB + Lambdas + log groups + API Gateway).
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation'

const cfn = new CloudFormationClient({})

export async function handler(): Promise<{ status: string }> {
  const stackName = process.env.DEMO_API_STACK_NAME
  if (!stackName) throw new Error('DEMO_API_STACK_NAME env missing')

  try {
    const existing = await cfn.send(new DescribeStacksCommand({ StackName: stackName }))
    const status = existing.Stacks?.[0]?.StackStatus
    if (!status || status.startsWith('DELETE_')) {
      return { status: `noop (${status ?? 'absent'})` }
    }
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'ValidationError') return { status: 'noop (absent)' }
    throw err
  }

  await cfn.send(new DeleteStackCommand({ StackName: stackName }))
  return { status: 'delete_requested' }
}
