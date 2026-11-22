export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} no encontrado`, 'not_found')
export const forbidden = (msg = 'No tienes permiso para esta acción') => new HttpError(403, msg, 'forbidden')
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request')
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict')
export const unauthorized = () => new HttpError(401, 'Necesitas iniciar sesión', 'unauthorized')
