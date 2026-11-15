import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last line of defence for the renderer: a thrown render error used to leave a
 * blank window with no way to recover. The fallback keeps the library intact
 * and offers a reload or an in-place retry.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Vavilon renderer error', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-fallback">
        <div className="error-card">
          <h2>Что-то пошло не так</h2>
          <p>
            Интерфейс столкнулся с ошибкой. Библиотека и сохранения на диске не затронуты —
            можно просто перезагрузить окно.
          </p>
          <pre className="error-details">{error.message || String(error)}</pre>
          <div className="error-actions">
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Попробовать снова
            </button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
          </div>
        </div>
      </div>
    )
  }
}
