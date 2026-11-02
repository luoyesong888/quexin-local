import React from 'react'
import ReactDOM from 'react-dom/client'
import { AccountRouter } from './AccountRouter'
import './styles.css'
import './mobile.css'
import { registerPwa } from './pwa'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AccountRouter />
  </React.StrictMode>,
)

registerPwa()
