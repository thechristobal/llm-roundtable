import { GoogleGenerativeAI } from '@google/generative-ai'

let client: GoogleGenerativeAI | null = null
function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '')
  return client
}

export async function askGoogle(prompt: string, systemPrompt?: string): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.6-flash',
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
  })
  const result = await model.generateContent(prompt)
  return result.response.text()
}
