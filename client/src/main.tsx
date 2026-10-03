import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import HostedGate from './components/HostedGate'
import { isHostedMode } from './lib/hostedMode'

const Root = isHostedMode()
  ? () => <HostedGate><App /></HostedGate>
  : () => <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
