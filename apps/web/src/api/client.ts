export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    ...init,
  })
  const text = await res.text()
  const data = text ? safeJson(text) : undefined
  if (!res.ok) {
    const msg = (data as any)?.message ?? `Error ${res.status}`
    throw new ApiError(res.status, msg, (data as any)?.error)
  }
  return data as T
}

function safeJson(t: string) {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
}

/** Descarga un endpoint que devuelve JSON como fichero. */
export async function download(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar')
  const disp = res.headers.get('content-disposition') ?? ''
  const m = disp.match(/filename="([^"]+)"/)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
