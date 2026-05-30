import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'
import { useProjectStore } from './store/projectStore'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0a0a0f',
          color: '#f8fafc',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: 24,
          whiteSpace: 'pre-wrap',
        }}>
          <h1 style={{ fontSize: 16, marginBottom: 12 }}>App render failed</h1>
          <div style={{ color: '#fca5a5' }}>{this.state.error.message}</div>
          <pre style={{ marginTop: 16, fontSize: 11, color: '#cbd5e1' }}>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Dev helper — exposed for console testing
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useProjectStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
