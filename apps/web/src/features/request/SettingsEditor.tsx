import type { ProtocolProfileBehavior } from '@cartero/core'
import { Switch } from '@/components/ui'
import { t } from "@/i18n";

const OPTIONS: { key: string; label: string; hint: string; def: boolean }[] = [
  { key: 'followRedirects', label: t("Seguir redirecciones"), hint: t("Sigue automáticamente las respuestas 3xx."), def: true },
  { key: 'followOriginalHttpMethod', label: t("Mantener el método al redirigir"), hint: t("Por defecto, al redirigir se cambia a GET."), def: false },
  { key: 'strictSSL', label: t("Verificar certificados SSL"), hint: t("Desactívalo para certificados autofirmados (útil en tu red local)."), def: false },
  { key: 'disableBodyPruning', label: t("Enviar body en GET/HEAD"), hint: t("Por defecto se elimina el body en métodos que no lo esperan."), def: false },
  { key: 'disableUrlEncoding', label: t("No codificar la URL"), hint: t("Envía la URL tal cual, sin escapar caracteres."), def: false },
  { key: 'disableCookies', label: t("No usar el cookie jar"), hint: t("Ni envía ni guarda cookies en esta petición."), def: false },
]

export function SettingsEditor({ value, onChange, readOnly }: { value?: ProtocolProfileBehavior; onChange: (v: ProtocolProfileBehavior | undefined) => void; readOnly?: boolean }) {
  return (
    <div className="max-w-2xl space-y-4 p-4">
      {OPTIONS.map((o) => {
        const current = (value?.[o.key] as boolean | undefined) ?? o.def
        return (
          <div key={o.key} className="flex items-start justify-between gap-6">
            <div>
              <div className="font-medium">{o.label}</div>
              <div className="text-xs text-muted">{o.hint}</div>
            </div>
            <Switch
              checked={current}
              onChange={(v) => {
                if (readOnly) return
                const next = { ...(value ?? {}) }
                if (v === o.def) delete next[o.key]
                else next[o.key] = v
                onChange(Object.keys(next).length ? next : undefined)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
