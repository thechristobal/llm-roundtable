import type { Round } from '../types'

export type ExportFormat = 'html'

export interface Exporter {
  mimeType: string
  extension: string
  generate(rounds: Round[], exportedAt: Date): Promise<string> | string
}
