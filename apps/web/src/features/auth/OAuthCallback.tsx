import { useEffect } from 'react'
import { t } from "@/i18n";

/** Destino del redirect OAuth 2.0: devuelve code/token a la ventana que abrió el popup. */
export function OAuthCallback() {
  useEffect(() => {
    const params: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(location.search)) params[k] = v
    for (const [k, v] of new URLSearchParams(location.hash.slice(1))) params[k] = v
    window.opener?.postMessage({ type: 'cartero-oauth', params }, location.origin)
    setTimeout(() => window.close(), 300)
  }, [])
  return <div className="flex h-full items-center justify-center text-muted">{t("Completando el login… puedes cerrar esta ventana.")}</div>
}
