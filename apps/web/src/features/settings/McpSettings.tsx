import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { Button, SubTabs } from '@/components/ui'

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="overflow-auto rounded-lg bg-zinc-900 p-4 pr-12 font-mono text-xs leading-relaxed text-zinc-100">{code}</pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="absolute top-2 right-2 rounded p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-white"
        aria-label="Copiar"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'otros'

export function McpSettings() {
  const [token, setToken] = useState<string>()
  const [client, setClient] = useState<Client>('claude-code')
  const qc = useQueryClient()
  const url = `${location.origin}/mcp`
  const tok = token ?? 'crt_TU_TOKEN'

  const create = async () => {
    const r = await api.post<{ token: string }>('/api/tokens', { name: `Asistente IA (MCP) ${new Date().toLocaleDateString()}` })
    setToken(r.token)
    qc.invalidateQueries({ queryKey: qk.tokens })
    toast.success('Token creado e insertado en las instrucciones')
  }

  const snippets: Record<Client, { intro: string; code: string; outro?: string }> = {
    'claude-code': {
      intro: 'Ejecuta en tu terminal:',
      code: `claude mcp add --transport http cartero ${url} \\\n  --header "Authorization: Bearer ${tok}"`,
      outro: 'Después, en Claude Code, prueba: «Ejecuta la colección Blog y explícame los fallos».',
    },
    'claude-desktop': {
      intro: 'Añade esto a claude_desktop_config.json (Ajustes → Desarrollador → Editar configuración) y reinicia Claude:',
      code: JSON.stringify({ mcpServers: { cartero: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${tok}`] } } }, null, 2),
      outro: 'Usa el puente mcp-remote, que conecta el servidor HTTP de Cartero con Claude Desktop.',
    },
    cursor: {
      intro: 'Añade esto a ~/.cursor/mcp.json (o .cursor/mcp.json en tu proyecto):',
      code: JSON.stringify({ mcpServers: { cartero: { url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2),
    },
    otros: {
      intro: 'Cualquier cliente MCP compatible con Streamable HTTP:',
      code: `URL:      ${url}\nCabecera: Authorization: Bearer ${tok}\n\n# O por stdio, desde el repositorio de Cartero:\nCARTERO_SERVER=${location.origin} CARTERO_TOKEN=${tok} \\\n  node packages/mcp/dist/stdio.js`,
    },
  }
  const s = snippets[client]

  return (
    <>
      <section className="mb-8">
        <h3 className="text-[15px] font-semibold">Conecta tu asistente de IA</h3>
        <p className="mt-1 text-muted">
          Cartero incluye un servidor <b>MCP</b> (Model Context Protocol). Con él, Claude, Cursor y otros asistentes pueden explorar tus colecciones, enviar peticiones, ejecutar
          tests, crear peticiones nuevas, importar especificaciones OpenAPI o generar código, siempre con tus permisos.
        </p>
      </section>
      <section className="mb-6">
        <div className="mb-2 font-medium">1. Crea un token</div>
        {token ? (
          <div className="rounded-lg border border-green-500/40 bg-green-500/8 p-3 text-xs">
            <div className="mb-1 font-medium text-green-700 dark:text-green-400">Token creado. Ya está puesto en las instrucciones de abajo; no se volverá a mostrar.</div>
            <code className="font-mono break-all">{token}</code>
          </div>
        ) : (
          <Button variant="primary" icon={<KeyRound className="size-3.5" />} onClick={create}>
            Crear token para el asistente
          </Button>
        )}
      </section>
      <section className="mb-6">
        <div className="mb-2 font-medium">2. Configura tu cliente</div>
        <SubTabs
          className="-mx-0 mb-3 px-0"
          value={client}
          onChange={setClient}
          tabs={[
            { id: 'claude-code', label: 'Claude Code' },
            { id: 'claude-desktop', label: 'Claude Desktop' },
            { id: 'cursor', label: 'Cursor' },
            { id: 'otros', label: 'Otros' },
          ]}
        />
        <p className="mb-2 text-muted">{s.intro}</p>
        <CodeBlock code={s.code} />
        {s.outro && <p className="mt-2 text-xs text-muted">{s.outro}</p>}
      </section>
      <section>
        <div className="mb-2 font-medium">Qué puede hacer</div>
        <ul className="grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
          {[
            'Listar workspaces, colecciones y entornos',
            'Buscar y ver peticiones',
            'Enviar peticiones (guardadas o sueltas)',
            'Ejecutar colecciones y analizar fallos',
            'Crear y modificar peticiones y tests',
            'Guardar variables de entorno',
            'Importar Postman, OpenAPI o cURL',
            'Generar código en más de 20 lenguajes',
            'Crear mock servers',
            'Consultar el historial de ejecuciones',
          ].map((t) => (
            <li key={t} className="flex items-start gap-1.5">
              <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Por seguridad, el asistente no puede borrar nada ni ver los valores de las variables secretas.</p>
      </section>
    </>
  )
}
