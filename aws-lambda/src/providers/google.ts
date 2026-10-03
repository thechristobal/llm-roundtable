import { GoogleGenerativeAI } from '@google/generative-ai'
import { classifyGoogleError } from '../../../server/src/adapters/errors.js'
import { GOOGLE_MODEL } from '../../../server/src/models.js'

export interface AskArgs {
  apiKey: string
  prompt: string
  systemPrompt?: string
  maxOutputTokens: number
  signal?: AbortSignal
}

export interface AskResult {
  content: string
  model: string
}

// No retry loop here. Lambda sits under a 110s orchestration deadline and a
// debate round has three providers racing; retrying inside one slot steals
// time from the others. Overloaded = emit provider_complete {ok:false}
// and let the UI surface it.
export async function askGoogle({ apiKey, prompt, systemPrompt, maxOutputTokens, signal }: AskArgs): Promise<AskResult> {
  const client = new GoogleGenerativeAI(apiKey)
  const model = client.getGenerativeModel({
    model: GOOGLE_MODEL,
    generationConfig: { maxOutputTokens },
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
  })
  try {
    const result = await model.generateContent(
      { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
      signal ? { signal } : undefined,
    )
    return { content: result.response.text(), model: GOOGLE_MODEL }
  } catch (err) {
    throw classifyGoogleError(err)
  }
}
