/** Returns the Express server base URL when running in Electron, empty string in web dev mode. */
export function apiBase(): string {
  if (typeof window !== 'undefined' && window.electronAPI?.serverPort) {
    return `http://127.0.0.1:${window.electronAPI.serverPort}`
  }
  return ''
}
