import type { ProtocolProfileBehavior } from '@cartero/core'
import { Switch } from '@/components/ui'

const OPTIONS: { key: string; label: string; hint: string; def: boolean }[] = [
  { key: 'followRedirects', label: 'Seguir redirecciones', hint: 'Sigue automáticamente las respuestas 3xx.', def: true },
  { key: 'followOriginalHttpMethod', label: 'Mantener el método al redirigir', hint: 'Por defecto, al redirigir se cambia a GET.', def: false },
  { key: 'strictSSL', label: 'Verificar certificados SSL', hint: 'Desactívalo para certificados autofirmados (útil en tu red local).', def: false },
  { key: 'disableBodyPruning', label: 'Enviar body en GET/HEAD', hint: 'Por defecto se elimina el body en métodos que no lo esperan.', def: false },
  { key: 'disableUrlEncoding', label: 'No codificar la URL', hint: 'Envía la URL tal cual, sin escapar caracteres.', def: false },
  { key: 'disableCookies', label: 'No usar el cookie jar', hint: 'Ni envía ni guarda cookies en esta petición.', def: false },
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
