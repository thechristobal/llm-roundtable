import type { Round } from '../types'

function isValidRounds(data: unknown): data is Round[] {
  if (!Array.isArray(data) || data.length === 0) return false
  return data.every(
    r => r && typeof r === 'object'
      && 'trigger' in r && 'panels' in r
      && typeof r.panels === 'object'
  )
}

export async function importDebate(file: File): Promise<Round[]> {
  const text = await file.text()
  const match = text.match(/<script type="application\/json" id="roundtable-data">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('No Roundtable data found in this file. Make sure you\'re importing an exported Roundtable HTML file.')

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    throw new Error('Roundtable data in this file is corrupted and could not be parsed.')
  }

  if (!isValidRounds(parsed)) throw new Error('Roundtable data has an unexpected shape. The file may be from an incompatible version.')

  return parsed
}
