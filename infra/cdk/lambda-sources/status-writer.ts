// Writes status.json to the permanent S3 bucket. Called:
//  (a) as a custom-resource during ephemeral demo-api stack CREATE
//      (write {available: true, expiresAt})
//  (b) as a custom-resource during ephemeral demo-api stack DELETE
//      (write {available: false, reason: 'teardown'})
//  (c) as the EventBridge Scheduler target that fires 5 minutes before
//      the ExpiryDays deadline (write {available: false, reason: 'expired'})
//
// CloudFront fetches /status.json from the permanent bucket. The client UI
// uses this as the authoritative "demo offline" signal; CF 5xx custom error
// pages render "demo unavailable" semantics instead.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import type { CloudFormationCustomResourceEvent, ScheduledEvent } from 'aws-lambda'

const s3 = new S3Client({})

interface StatusBody {
  available: boolean
  reason?: 'teardown' | 'expired' | 'maintenance'
  expiresAt?: string
  updatedAt: string
}

async function putStatus(bucket: string, body: StatusBody): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: 'status.json',
    Body: JSON.stringify(body),
    ContentType: 'application/json',
    CacheControl: 'no-cache, max-age=0',
  }))
}

type AnyEvent = CloudFormationCustomResourceEvent | ScheduledEvent

function isCfnEvent(event: AnyEvent): event is CloudFormationCustomResourceEvent {
  return 'RequestType' in event
}

export async function handler(event: AnyEvent): Promise<{ PhysicalResourceId?: string }> {
  const bucket = process.env.STATUS_BUCKET
  if (!bucket) throw new Error('STATUS_BUCKET env missing')
  const now = new Date().toISOString()

  if (isCfnEvent(event)) {
    const props = event.ResourceProperties as Record<string, string>
    const physicalId = `status-writer-${props.scope ?? 'default'}`
    if (event.RequestType === 'Delete') {
      await putStatus(bucket, { available: false, reason: 'teardown', updatedAt: now })
      return { PhysicalResourceId: physicalId }
    }
    const body: StatusBody = {
      available: true,
      updatedAt: now,
      ...(props.expiresAt ? { expiresAt: props.expiresAt } : {}),
    }
    await putStatus(bucket, body)
    return { PhysicalResourceId: physicalId }
  }

  // EventBridge scheduled invocation: unconditionally flip to expired.
  await putStatus(bucket, { available: false, reason: 'expired', updatedAt: now })
  return {}
}
