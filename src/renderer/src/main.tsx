import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { FeedbackProvider } from './lib/feedback'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FeedbackProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </FeedbackProvider>
  </React.StrictMode>
)
