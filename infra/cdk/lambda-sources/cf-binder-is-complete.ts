// Called repeatedly by the Provider framework's waiter state machine until
// IsComplete=true. CloudFront propagation to all edges takes 5-15 minutes;
// the Provider polls at a configurable interval (we set queryInterval=30s,
// totalTimeout=20m in the construct).
import { CloudFrontClient, GetDistributionCommand } from '@aws-sdk/client-cloudfront'

const cf = new CloudFrontClient({})

// The Provider framework calls this with the original CFN event plus
// whatever Data the onEvent handler returned. We only need the props.
interface IsCompleteEvent {
  ResourceProperties: { distributionId?: string }
}

export async function handler(event: IsCompleteEvent): Promise<{ IsComplete: boolean }> {
  const distributionId = event.ResourceProperties.distributionId
  if (!distributionId) throw new Error('distributionId missing from props')
  const result = await cf.send(new GetDistributionCommand({ Id: distributionId }))
  return { IsComplete: result.Distribution?.Status === 'Deployed' }
}
