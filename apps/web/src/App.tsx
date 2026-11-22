import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useMe, useWorkspaces } from './api/hooks'
import { Spinner } from './components/ui'
import { InvitePage, LoginPage, RegisterPage } from './features/auth/AuthPages'
import { OAuthCallback } from './features/auth/OAuthCallback'
import { PublicDocs } from './features/docs/PublicDocs'
import { ManualPage } from './features/manual/ManualPage'
import { WorkspaceLayout } from './features/workspace/Layout'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe()
  const loc = useLocation()
  if (isLoading) return <FullSpinner />
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <>{children}</>
}

function Home() {
  const { data, isLoading } = useWorkspaces()
  if (isLoading || !data) return <FullSpinner />
  const last = localStorage.getItem('cartero-last-ws')
  const ws = data.find((w) => w.id === last) ?? data[0]
  return <Navigate to={`/w/${ws.id}`} replace />
}

function FullSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/docs/:slug" element={<PublicDocs />} />
      <Route path="/oauth/callback" element={<OAuthCallback />} />
      <Route path="/ayuda" element={<ManualPage />} />
      <Route path="/ayuda/:slug" element={<ManualPage />} />
      <Route
        path="/w/:ws/*"
        element={
          <RequireAuth>
            <WorkspaceLayout />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
