import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import { chatRouter } from './routes/chat'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors())
app.use(express.json())

app.use('/api/chat', chatRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log('API keys loaded:')
  console.log(`  OpenAI:    ${process.env.OPENAI_API_KEY ? 'YES' : 'missing (mock mode)'}`)
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'YES' : 'missing (mock mode)'}`)
  console.log(`  Google:    ${process.env.GOOGLE_API_KEY ? 'YES' : 'missing (mock mode)'}`)
})
