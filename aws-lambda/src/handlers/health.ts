import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, ts: Date.now() }),
  }
}
