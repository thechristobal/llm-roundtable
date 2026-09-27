// Renderer-side shim over the shared Electron IPC contract. The types live
// in shared/electron-ipc.ts (single source of truth); this file just re-exports
// them under the friendly names existing renderer code already imports from
// '../electron', and augments the global Window with the electronAPI shape.
export type { ClaudeCliStatus, ProviderStatus } from '../../shared/electron-ipc'
import type { ElectronAPI } from '../../shared/electron-ipc'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
