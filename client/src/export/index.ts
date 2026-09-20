import type { Round } from '../types'
import { htmlExporter } from './html'
import type { ExportFormat, Exporter } from './types'

const exporters: Record<ExportFormat, Exporter> = {
  html: htmlExporter,
}

export async function downloadDebate(format: ExportFormat, rounds: Round[]): Promise<void> {
  const exporter = exporters[format]
  const exportedAt = new Date()
  const content = await exporter.generate(rounds, exportedAt)
  const filename = `roundtable-${exportedAt.toISOString().slice(0, 10)}.${exporter.extension}`
  const blob = new Blob([content], { type: `${exporter.mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
