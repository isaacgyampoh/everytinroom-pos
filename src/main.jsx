import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// The outermost net. The boundary inside App covers a crash in a page; this
// one covers everything else — the nav, the basket drawer, the sign-in screen,
// App itself — any of which would otherwise leave the till a blank window.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
