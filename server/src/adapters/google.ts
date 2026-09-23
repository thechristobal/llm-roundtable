import { GoogleGenerativeAI } from '@google/generative-ai'
import { GOOGLE_MODEL } from '../models.js'

let client: GoogleGenerativeAI | null = null
function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')
  return client
}

async function attempt(prompt: string, systemPrompt?: string): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: GOOGLE_MODEL,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
  })
  const result = await model.generateContent(prompt)
  return result.response.text()
}

export async function askGoogle(prompt: string, systemPrompt?: string): Promise<string> {
  const maxRetries = 6
  let lastError: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await attempt(prompt, systemPrompt)
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      const isQuota = /429|quota|RESOURCE_EXHAUSTED/i.test(msg)
      const isOverloaded = /503|overloaded|high demand|service unavailable/i.test(msg)
      const isPermanent = isQuota || (!isOverloaded && /4\d\d|invalid|not found|unauthorized|forbidden/i.test(msg))
      if (isPermanent || i === maxRetries - 1) {
        if (isQuota) throw new Error(`QUOTA_EXCEEDED: ${msg}`)
        if (isOverloaded) throw new Error(`GEMINI_OVERLOADED: ${msg}`)
        throw err
      }
      const delay = isOverloaded ? 3000 * (i + 1) : 1500 * (i + 1)
      console.warn(`Gemini error, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}): ${msg}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  throw lastError
}
