import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full text-red-400 text-sm p-8">
          <div>
            <p className="font-semibold mb-2">Render error</p>
            <pre className="text-xs opacity-70 whitespace-pre-wrap">{this.state.error.message}</pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
