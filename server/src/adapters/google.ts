import { GoogleGenerativeAI } from '@google/generative-ai'
import { GOOGLE_MODEL } from '../models.js'
import { classifyGoogleError } from './errors.js'

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

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await attempt(prompt, systemPrompt)
    } catch (err) {
      const classified = classifyGoogleError(err)
      // Only 'overloaded' is transient enough to retry; every other category is
      // permanent (quota, auth) or already terminal (unknown → fail fast).
      const isTransient = classified.category === 'overloaded'
      if (!isTransient || i === maxRetries - 1) {
        throw classified
      }
      const delay = 3000 * (i + 1)
      console.warn(`Gemini error, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}): ${classified.message}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }

  // Unreachable: loop either returns or throws.
  throw new Error('askGoogle: unreachable')
}
