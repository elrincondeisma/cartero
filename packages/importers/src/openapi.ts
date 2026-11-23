import converter from 'openapi-to-postmanv2'
import { attachContracts } from '@cartero/contracts'
import { type Collection, POSTMAN_SCHEMA_V21, ensureIds } from '@cartero/core'

export function isOpenApi(json: any): boolean {
  return (
    !!json &&
    typeof json === 'object' &&
    (typeof json.openapi === 'string' || typeof json.swagger === 'string')
  )
}

/** Convierte OpenAPI 3.0/3.1 o Swagger 2.0 en una colección. */
export function importOpenApi(spec: any): Promise<{ collection: Collection; warnings: string[] }> {
  // openapi-to-postmanv2 modifica la especificación (rellena defaults como «<string>»):
  // los contratos se sacan de una copia intacta
  const pristine = structuredClone(spec)
  return new Promise((resolve, reject) => {
    converter.convert(
      { type: 'json', data: spec },
      {
        folderStrategy: 'Tags',
        parametersResolution: 'Example',
        requestNameSource: 'Fallback',
        indentCharacter: '  ',
      },
      (err, out) => {
        if (err) return reject(err)
        if (!out?.result)
          return reject(new Error(out?.reason ?? 'No se pudo convertir la especificación OpenAPI'))
        const collection = out.output[0].data as Collection
        collection.info.schema = POSTMAN_SCHEMA_V21
        // El conversor pierde los esquemas: se recuperan como contratos de cada petición
        const warnings: string[] = []
        try {
          const n = attachContracts(collection, pristine)
          if (n) warnings.push(`${n} petición(es) con contrato importado desde los esquemas de OpenAPI.`)
        } catch {
          warnings.push('No se han podido leer los esquemas de OpenAPI; las peticiones llegan sin contrato.')
        }
        resolve({ collection: ensureIds(collection), warnings })
      },
    )
  })
}
