import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

const ssm = new SSMClient({})
const cache = new Map<string, string>()

export async function getSsmSecret(name: string): Promise<string> {
  const cached = cache.get(name)
  if (cached) return cached
  const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
  const value = res.Parameter?.Value
  if (!value) throw new Error(`SSM parameter ${name} has no value`)
  cache.set(name, value)
  return value
}

export function clearSecretCache(): void {
  cache.clear()
}
