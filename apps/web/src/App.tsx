import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { useMe, useWorkspaces } from './api/hooks'
import { Spinner } from './components/ui'
import { AdminPage } from './features/admin/AdminPage'
import { InvitePage, LoginPage, RegisterPage } from './features/auth/AuthPages'
import { t } from './i18n'
import { useUi } from './store/ui'
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

// Lo que trae la URL al volver de Google o GitHub (se lee antes de que las redirecciones la cambien)
const oauthParams = new URLSearchParams(location.search)

const OAUTH_ERRORS: Record<string, string> = {
  provider_disabled: t('Ese método de acceso no está activado.'),
  invalid_state: t('El inicio de sesión ha caducado. Vuelve a intentarlo.'),
  cancelled: t('Has cancelado el inicio de sesión.'),
  provider_error: t('No hemos podido hablar con el proveedor. Vuelve a intentarlo.'),
  email_unverified: t('Tu cuenta no tiene un email verificado.'),
  registration_closed: t('El registro está cerrado. Pide a un administrador que te invite.'),
  domain_not_allowed: t('Tu dominio de email no puede registrarse en esta instancia.'),
  account_disabled: t('Tu cuenta está desactivada. Habla con un administrador.'),
  already_linked: t('Esa cuenta ya está vinculada a otro usuario.'),
}

function useOAuthNotice() {
  const openSettings = useUi((s) => s.openSettings)
  useEffect(() => {
    const error = oauthParams.get('oauth_error')
    const linked = oauthParams.get('oauth_linked')
    if (!error && !linked) return
    if (error) toast.error(OAUTH_ERRORS[error] ?? t('No se ha podido iniciar sesión.'))
    if (linked) {
      toast.success(t('Cuenta de {0} vinculada', [linked === 'google' ? 'Google' : 'GitHub']))
      openSettings('profile')
    }
    const url = new URL(location.href)
    url.searchParams.delete('oauth_error')
    url.searchParams.delete('oauth_linked')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
    // Los errores al vincular desde Ajustes vuelven a la app (no al login): se reabre el perfil
    if (error && location.pathname !== '/login') openSettings('profile')
  }, [openSettings])
}

export function App() {
  useOAuthNotice()
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
        path="/admin"
        element={
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        }
      />
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
