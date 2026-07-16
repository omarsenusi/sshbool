import { Component, type ErrorInfo, type ReactNode } from "react"

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Editor popout crashed", error, info)
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="bg-background text-destructive flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <p className="font-semibold">Something went wrong</p>
            <p className="text-muted-foreground max-w-md text-xs">
              {this.state.error.message}
            </p>
          </div>
        )
      )
    }
    return this.props.children
  }
}
