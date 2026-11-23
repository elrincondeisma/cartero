import type { Contract, ContractParam, Request } from '@cartero/core'
import { hasContract, inferFromText, requestContractFrom } from '@cartero/contracts'
import { ArrowDownToLine, Braces, FileCheck2, History, Plus, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ExecResponse } from '@/api/types'
import { CodeEditor } from '@/components/CodeEditor'
import { confirm, prompt } from '@/components/dialogs'
import { Badge, Button, Empty, Input, cx, statusTone } from '@/components/ui'
import { t } from '@/i18n'
import { ContractHistory } from './ContractHistory'
import { ParamsTable } from './ParamsTable'
import { SchemaEditor } from './SchemaEditor'

type View = { kind: 'request' } | { kind: 'response'; code: string } | { kind: 'history' }

const CODE_RE = /^([1-5]\d\d|[1-5]XX|default)$/i

function sortCodes(codes: string[]) {
  return [...codes].sort((a, b) => (a === 'default' ? 1 : b === 'default' ? -1 : a.localeCompare(b)))
}

/** Une los parámetros que faltan sin tocar los que ya están en el contrato. */
function mergeParams(current: ContractParam[] | undefined, extra: ContractParam[] | undefined) {
  const out = [...(current ?? [])]
  for (const p of extra ?? []) if (!out.some((q) => q.name.toLowerCase() === p.name.toLowerCase())) out.push(p)
  return out.length ? out : undefined
}

/**
 * Pestaña «Contrato» de una petición: lo que envía el frontend y lo que debe devolver el
 * backend en cada código. Se edita con un árbol de campos o directamente como JSON Schema.
 */
export function ContractEditor({
  contract,
  onChange,
  request,
  lastResponse,
  readOnly,
  collectionId,
  itemId,
}: {
  contract: Contract | undefined
  onChange: (c: Contract | undefined) => void
  request: Request
  lastResponse?: ExecResponse
  readOnly?: boolean
  collectionId?: string | null
  itemId?: string | null
}) {
  const codes = sortCodes(Object.keys(contract?.responses ?? {}))
  const [view, setView] = useState<View>(() => (codes.length ? { kind: 'response', code: codes[0] } : { kind: 'request' }))
  const [asJson, setAsJson] = useState(false)

  // Si el código seleccionado desaparece (otra persona, restaurar versión…), vuelve al primero
  useEffect(() => {
    if (view.kind === 'response' && !contract?.responses?.[view.code])
      setView(codes.length ? { kind: 'response', code: codes[0] } : { kind: 'request' })
  }, [contract, view])

  const fromLastResponse = () => {
    if (!lastResponse) return
    const code = String(lastResponse.code)
    const body = inferFromText(lastResponse.body)
    const base: Contract = contract ?? { responses: {} }
    const existing = base.responses[code]
    const next: Contract = {
      ...base,
      request: base.request ?? requestContractFrom(request),
      responses: { ...base.responses, [code]: { ...existing, description: existing?.description || lastResponse.status, body: body ?? existing?.body } },
    }
    onChange(next)
    setView({ kind: 'response', code })
    toast.success(
      body
        ? t('Estructura del {0} generada desde la última respuesta. Revisa qué campos son obligatorios.', [code])
        : t('La última respuesta no es JSON: se ha añadido el código {0} sin cuerpo.', [code]),
    )
  }

  if (!hasContract(contract) && !asJson) {
    return (
      <Empty
        icon={<FileCheck2 className="size-6" />}
        title={t('Sin contrato')}
        action={
          !readOnly && (
            <div className="flex flex-wrap justify-center gap-2">
              {lastResponse && (
                <Button variant="primary" icon={<Wand2 className="size-3.5" />} onClick={fromLastResponse}>
                  {t('Generar desde la última respuesta')}
                </Button>
              )}
              <Button
                icon={<Plus className="size-3.5" />}
                onClick={() => {
                  onChange({
                    request: requestContractFrom(request),
                    responses: { '200': { description: 'OK', body: { type: 'object', properties: {}, required: [] } } },
                  })
                  setView({ kind: 'response', code: '200' })
                }}
              >
                {t('Empezar en blanco')}
              </Button>
              {itemId && collectionId && (
                <Button variant="ghost" icon={<History className="size-3.5" />} onClick={() => setView({ kind: 'history' })}>
                  {t('Historial')}
                </Button>
              )}
            </div>
          )
        }
      >
        {view.kind === 'history' && itemId && collectionId ? (
          <div className="mt-3 h-72 w-[min(640px,80vw)] text-left">
            <ContractHistory collectionId={collectionId} itemId={itemId} />
          </div>
        ) : (
          t(
            'El contrato fija lo que envía el frontend y lo que debe devolver el backend en cada código. Cartero lo comprueba al enviar la petición y el mock responde con datos que lo cumplen.',
          )
        )}
      </Empty>
    )
  }

  const c: Contract = contract ?? { responses: {} }
  const setRequest = (patch: Partial<NonNullable<Contract['request']>>) => {
    const next = { ...(c.request ?? {}), ...patch }
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      const v = next[k]
      if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k]
    }
    onChange({ ...c, request: Object.keys(next).length ? next : undefined })
  }
  const setResponse = (code: string, patch: Partial<Contract['responses'][string]>) =>
    onChange({ ...c, responses: { ...c.responses, [code]: { ...c.responses[code], ...patch } } })

  const addCode = async () => {
    const code = (await prompt(t('Nuevo código de respuesta'), { label: t('Un código (200, 404…), un rango (4XX) o «default»'), value: codes.includes('200') ? '400' : '200', confirm: t('Añadir') }))?.trim()
    if (!code) return
    if (!CODE_RE.test(code)) return toast.error(t('«{0}» no es un código de estado válido', [code]))
    const key = code.toLowerCase() === 'default' ? 'default' : code.toUpperCase()
    if (!c.responses[key]) onChange({ ...c, responses: { ...c.responses, [key]: { body: { type: 'object', properties: {}, required: [] } } } })
    setView({ kind: 'response', code: key })
  }

  const removeContract = async () => {
    if (!(await confirm(t('Quitar el contrato'), t('Se borran la parte de petición y todas las respuestas. Queda en el historial al guardar.'), { confirm: t('Quitar'), danger: true }))) return
    onChange(undefined)
    setAsJson(false)
    setView({ kind: 'request' })
  }

  const navItem = (active: boolean, onClick: () => void, children: React.ReactNode) => (
    <button
      onClick={onClick}
      className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]', active ? 'bg-muted' : 'hover:bg-muted/60')}
    >
      {children}
    </button>
  )

  return (
    <div className="flex h-full">
      <div className="flex w-52 shrink-0 flex-col border-r border-app p-2">
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {navItem(!asJson && view.kind === 'request', () => (setAsJson(false), setView({ kind: 'request' })), (
            <>
              <ArrowDownToLine className="size-3.5 rotate-180 text-muted" />
              <span>{t('Petición')}</span>
            </>
          ))}
          <div className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted">{t('Respuestas')}</div>
          {codes.map((code) =>
            navItem(!asJson && view.kind === 'response' && view.code === code, () => (setAsJson(false), setView({ kind: 'response', code })), (
              <>
                <Badge tone={statusTone(Number(code[0]) * 100)} className="font-mono">
                  {code}
                </Badge>
                <span className="truncate text-muted">{c.responses[code]?.description}</span>
              </>
            )),
          )}
          {!readOnly && (
            <button onClick={addCode} className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-brand-700 hover:bg-muted dark:text-brand-400">
              <Plus className="size-3.5" /> {t('Código de respuesta')}
            </button>
          )}
        </div>
        <div className="space-y-0.5 border-t border-app pt-2">
          {itemId && collectionId && navItem(!asJson && view.kind === 'history', () => (setAsJson(false), setView({ kind: 'history' })), (
            <>
              <History className="size-3.5 text-muted" /> <span>{t('Historial')}</span>
            </>
          ))}
          {navItem(asJson, () => setAsJson(!asJson), (
            <>
              <Braces className="size-3.5 text-muted" /> <span>{t('Ver como JSON Schema')}</span>
            </>
          ))}
          {!readOnly && (
            <button onClick={removeContract} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-red-600 hover:bg-muted dark:text-red-400">
              <Trash2 className="size-3.5" /> {t('Quitar el contrato')}
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto">
        {asJson ? (
          <JsonView contract={c} onChange={onChange} readOnly={readOnly} />
        ) : view.kind === 'history' && itemId && collectionId ? (
          <ContractHistory collectionId={collectionId} itemId={itemId} />
        ) : view.kind === 'request' ? (
          <div className="space-y-4 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted">{t('Lo que debe enviar el frontend. Cartero avisa al enviar si la petición no lo cumple.')}</p>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Wand2 className="size-3.5" />}
                  onClick={() => {
                    const r = requestContractFrom(request)
                    setRequest({
                      path: mergeParams(c.request?.path, r.path),
                      query: mergeParams(c.request?.query, r.query),
                      headers: mergeParams(c.request?.headers, r.headers),
                      body: c.request?.body ?? r.body,
                    })
                  }}
                >
                  {t('Completar con la petición actual')}
                </Button>
              )}
            </div>
            <Section title={t('Parámetros de ruta')}>
              <ParamsTable rows={c.request?.path ?? []} onChange={(path) => setRequest({ path })} readOnly={readOnly} fixedRequired addLabel={t('Parámetro')} />
            </Section>
            <Section title={t('Query')}>
              <ParamsTable rows={c.request?.query ?? []} onChange={(query) => setRequest({ query })} readOnly={readOnly} addLabel={t('Parámetro')} />
            </Section>
            <Section title={t('Cabeceras')}>
              <ParamsTable rows={c.request?.headers ?? []} onChange={(headers) => setRequest({ headers })} readOnly={readOnly} addLabel={t('Cabecera')} />
            </Section>
            <Section
              title={t('Cuerpo')}
              right={
                !readOnly &&
                (c.request?.body ? (
                  <Button size="sm" variant="ghost" onClick={() => setRequest({ body: undefined })}>
                    {t('Sin cuerpo')}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRequest({ body: { type: 'object', properties: {}, required: [] } })}>
                    {t('Definir cuerpo')}
                  </Button>
                ))
              }
            >
              {c.request?.body ? (
                <SchemaEditor schema={c.request.body} onChange={(body) => setRequest({ body })} readOnly={readOnly} />
              ) : (
                <p className="text-xs text-muted">{t('Esta petición no lleva cuerpo en el contrato.')}</p>
              )}
            </Section>
          </div>
        ) : view.kind === 'response' && c.responses[view.code] ? (
          <ResponseView
            code={view.code}
            spec={c.responses[view.code]}
            readOnly={readOnly}
            canGenerate={!!lastResponse && String(lastResponse.code) === view.code}
            onGenerate={fromLastResponse}
            onChange={(patch) => setResponse(view.code, patch)}
            onRemove={() => {
              const { [view.code]: _gone, ...rest } = c.responses
              onChange({ ...c, responses: rest })
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  )
}

function ResponseView({
  code,
  spec,
  readOnly,
  canGenerate,
  onGenerate,
  onChange,
  onRemove,
}: {
  code: string
  spec: Contract['responses'][string]
  readOnly?: boolean
  canGenerate: boolean
  onGenerate: () => void
  onChange: (patch: Partial<Contract['responses'][string]>) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center gap-2">
        <Badge tone={statusTone(Number(code[0]) * 100)} className="font-mono">
          {code}
        </Badge>
        <Input
          value={spec.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder={t('Cuándo se devuelve (opcional)')}
          className="h-7 flex-1 text-xs"
          readOnly={readOnly}
        />
        {!readOnly && canGenerate && (
          <Button size="sm" variant="outline" icon={<Wand2 className="size-3.5" />} onClick={onGenerate}>
            {t('Generar desde la última respuesta')}
          </Button>
        )}
        {!readOnly && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
            {t('Quitar código')}
          </Button>
        )}
      </div>
      <Section title={t('Cabeceras')}>
        <ParamsTable rows={spec.headers ?? []} onChange={(headers) => onChange({ headers: headers.length ? headers : undefined })} readOnly={readOnly} addLabel={t('Cabecera')} />
      </Section>
      <Section
        title={t('Cuerpo')}
        right={
          !readOnly &&
          (spec.body ? (
            <Button size="sm" variant="ghost" onClick={() => onChange({ body: undefined })}>
              {t('Sin cuerpo')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange({ body: { type: 'object', properties: {}, required: [] } })}>
              {t('Definir cuerpo')}
            </Button>
          ))
        }
      >
        {spec.body ? (
          <SchemaEditor schema={spec.body} onChange={(body) => onChange({ body })} readOnly={readOnly} />
        ) : (
          <p className="text-xs text-muted">{t('Esta respuesta no lleva cuerpo (por ejemplo, un 204).')}</p>
        )}
      </Section>
    </div>
  )
}

/** El contrato entero como JSON: para quien prefiera escribir el esquema a mano. */
function JsonView({ contract, onChange, readOnly }: { contract: Contract; onChange: (c: Contract | undefined) => void; readOnly?: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(contract, null, 2))
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex h-full flex-col">
      <div className={cx('shrink-0 border-b border-app px-3 py-1.5 text-[11px]', error ? 'text-red-600 dark:text-red-400' : 'text-muted')}>
        {error ?? t('Cada respuesta lleva su JSON Schema (draft 2020-12, el de OpenAPI 3.1).')}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={text}
          language="json"
          readOnly={readOnly}
          path="contract.json"
          onChange={(v) => {
            setText(v)
            try {
              const parsed = JSON.parse(v)
              if (!parsed || typeof parsed !== 'object' || typeof parsed.responses !== 'object')
                throw new Error(t('Falta el objeto «responses»'))
              setError(null)
              onChange(parsed)
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      </div>
    </div>
  )
}
