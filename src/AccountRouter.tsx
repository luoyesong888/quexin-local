import { useEffect, useRef, useState } from 'react'
import { WorkspaceGate } from './account-workspace'
import { AccountPage } from './AccountPage'
import { readAccountRoute, scrubAccountUrl } from './account-route'

export function AccountRouter() {
  const [navigation, setNavigation] = useState(() => ({ route: readAccountRoute(new URL(window.location.href)), version: 0 }))
  const observedUrl = useRef(window.location.href)
  const { route } = navigation
  useEffect(() => {
    const navigate = () => {
      if (observedUrl.current === window.location.href) return
      observedUrl.current = window.location.href
      const next = readAccountRoute(new URL(window.location.href))
      setNavigation(previous => ({ route: next, version: previous.version + 1 }))
    }
    window.addEventListener('hashchange', navigate)
    window.addEventListener('popstate', navigate)
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate) }
  }, [])
  useEffect(() => { if (route) { scrubAccountUrl(route); observedUrl.current = window.location.href } }, [route])
  if (route) return <AccountPage key={navigation.version} route={route} />
  return <WorkspaceGate />
}
