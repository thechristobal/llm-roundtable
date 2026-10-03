// CREATE/UPDATE: fetch the CloudFront DistributionConfig, swap the /api/*
// origin to point at the demo-api REST endpoint, call UpdateDistribution
// with the ETag as IfMatch. DELETE: same shape but reset the /api/*
// origin back to the placeholder.
//
// Does NOT wait for Distribution.Status=Deployed — that's the isComplete
// handler's job, called repeatedly by the Provider framework.
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront'
import type { CloudFormationCustomResourceEvent } from 'aws-lambda'

const cf = new CloudFrontClient({})

interface OnEventProps {
  distributionId: string
  apiOriginId: string
  apiOriginDomain: string
  apiOriginPath: string
  placeholderOriginDomain: string
  placeholderOriginPath: string
}

interface OnEventResult {
  PhysicalResourceId: string
  Data: { etag: string }
}

function readProps(event: CloudFormationCustomResourceEvent): OnEventProps {
  const props = event.ResourceProperties as Record<string, string> & { ServiceToken: string }
  return {
    distributionId: props.distributionId,
    apiOriginId: props.apiOriginId,
    apiOriginDomain: props.apiOriginDomain,
    apiOriginPath: props.apiOriginPath,
    placeholderOriginDomain: props.placeholderOriginDomain,
    placeholderOriginPath: props.placeholderOriginPath,
  }
}

export async function handler(event: CloudFormationCustomResourceEvent): Promise<OnEventResult> {
  const props = readProps(event)
  const targetDomain = event.RequestType === 'Delete' ? props.placeholderOriginDomain : props.apiOriginDomain
  const targetPath = event.RequestType === 'Delete' ? props.placeholderOriginPath : props.apiOriginPath

  const config = await cf.send(new GetDistributionConfigCommand({ Id: props.distributionId }))
  if (!config.DistributionConfig || !config.ETag) {
    throw new Error(`GetDistributionConfig returned empty for ${props.distributionId}`)
  }

  const dc = config.DistributionConfig
  const origins = dc.Origins?.Items ?? []
  const apiOrigin = origins.find(o => o.Id === props.apiOriginId)
  if (!apiOrigin) {
    throw new Error(`Origin ${props.apiOriginId} missing from distribution ${props.distributionId}`)
  }
  apiOrigin.DomainName = targetDomain
  apiOrigin.OriginPath = targetPath

  await cf.send(new UpdateDistributionCommand({
    Id: props.distributionId,
    IfMatch: config.ETag,
    DistributionConfig: dc,
  }))

  return {
    PhysicalResourceId: `cf-binder-${props.distributionId}`,
    Data: { etag: config.ETag },
  }
}
