import { GoogleGenerativeAI } from '@google/generative-ai'

let client: GoogleGenerativeAI | null = null
function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')
  return client
}

async function attempt(prompt: string, systemPrompt?: string): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.6-flash',
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
  })
  const result = await model.generateContent(prompt)
  return result.response.text()
}

export async function askGoogle(prompt: string, systemPrompt?: string): Promise<string> {
  const maxRetries = 4
  let lastError: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await attempt(prompt, systemPrompt)
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      const isQuota = /429|quota|RESOURCE_EXHAUSTED/i.test(msg)
      const isPermanent = isQuota || /4\d\d|invalid|not found|unauthorized|forbidden/i.test(msg)
      if (isPermanent || i === maxRetries - 1) {
        if (isQuota) throw new Error(`QUOTA_EXCEEDED: ${msg}`)
        throw err
      }
      console.warn(`Gemini error, retrying (attempt ${i + 1}/${maxRetries}): ${msg}`)
      await new Promise(r => setTimeout(r, 1500 * (i + 1)))
    }
  }

  throw lastError
}
