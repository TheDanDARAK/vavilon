import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { BigPicture } from './components/BigPicture'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FeedbackProvider } from './lib/feedback'
import './styles.css'

/**
 * `--bigpicture` (gamepad/streaming mode) loads the same bundle with a query
 * flag, so the renderer can pick the fullscreen shell instead of the library.
 */
const bigPicture = new URLSearchParams(window.location.search).get('bigpicture') === '1'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FeedbackProvider>
      <ErrorBoundary>{bigPicture ? <BigPicture /> : <App />}</ErrorBoundary>
    </FeedbackProvider>
  </React.StrictMode>
)
