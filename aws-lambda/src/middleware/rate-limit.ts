import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { UpdateCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { createHmac } from 'node:crypto'
import { getSsmSecret } from './secrets.js'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export class RateLimitExceeded extends Error {
  constructor(public readonly scope: 'session' | 'ip') {
    super(`Rate limit exceeded (${scope})`)
    this.name = 'RateLimitExceeded'
  }
}

interface ConsumeArgs {
  pk: string
  limit: number
  windowSeconds: number
}

// Atomic token-bucket decrement. First request in a window seeds count=limit-1
// via ADD, which creates the item if missing. Subsequent requests ADD -1 but
// a ConditionExpression on count > 0 prevents going negative, which throws
// ConditionalCheckFailedException → caller sees RateLimitExceeded.
async function consume({ pk, limit, windowSeconds }: ConsumeArgs, scope: 'session' | 'ip'): Promise<void> {
  const table = process.env.RATE_LIMIT_TABLE
  if (!table) throw new Error('RATE_LIMIT_TABLE env missing')
  const expiresAt = Math.floor(Date.now() / 1000) + windowSeconds

  try {
    await ddb.send(new UpdateCommand({
      TableName: table,
      Key: { pk },
      UpdateExpression: 'ADD #c :neg SET #e = if_not_exists(#e, :exp), #cap = if_not_exists(#cap, :cap)',
      ConditionExpression: 'attribute_not_exists(#c) OR #c > :zero',
      ExpressionAttributeNames: { '#c': 'count', '#e': 'expiresAt', '#cap': 'capacity' },
      ExpressionAttributeValues: {
        ':neg': -1,
        ':exp': expiresAt,
        ':zero': 0,
        ':cap': limit,
      },
    }))
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new RateLimitExceeded(scope)
    }
    throw err
  }

  await ddb.send(new UpdateCommand({
    TableName: table,
    Key: { pk },
    UpdateExpression: 'SET #c = if_not_exists(#c, :cap_minus_one)',
    ExpressionAttributeNames: { '#c': 'count' },
    ExpressionAttributeValues: { ':cap_minus_one': limit - 1 },
    ConditionExpression: 'attribute_not_exists(#c)',
  })).catch(() => {})
}

export async function consumeSessionBucket(jti: string, limit: number, windowSeconds: number): Promise<void> {
  await consume({ pk: `sess:${jti}`, limit, windowSeconds }, 'session')
}

export async function consumeIpBucket(sourceIp: string, limit: number, windowSeconds: number): Promise<void> {
  const secret = await getSsmSecret(process.env.IP_HASH_SECRET_PARAM!)
  const utcDate = new Date().toISOString().slice(0, 10)
  const hash = createHmac('sha256', secret).update(`${utcDate}|${sourceIp}`).digest('hex').slice(0, 32)
  await consume({ pk: `ip:${hash}`, limit, windowSeconds }, 'ip')
}
