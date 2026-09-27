import OpenAI from 'openai'
import { classifyOpenAIError } from './errors.js'

let client: OpenAI | null = null
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

export async function askOpenAI(prompt: string): Promise<string> {
  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    })
    return response.choices[0].message.content ?? ''
  } catch (err) {
    throw classifyOpenAIError(err)
  }
}
