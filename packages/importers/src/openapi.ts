import converter from 'openapi-to-postmanv2'
import { type Collection, POSTMAN_SCHEMA_V21, ensureIds } from '@cartero/core'

export function isOpenApi(json: any): boolean {
  return !!json && typeof json === 'object' && (typeof json.openapi === 'string' || typeof json.swagger === 'string')
}

/** Convierte OpenAPI 3.0/3.1 o Swagger 2.0 en una colección. */
export function importOpenApi(spec: any): Promise<{ collection: Collection; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    converter.convert(
      { type: 'json', data: spec },
      { folderStrategy: 'Tags', parametersResolution: 'Example', requestNameSource: 'Fallback', indentCharacter: '  ' },
      (err, out) => {
        if (err) return reject(err)
        if (!out?.result) return reject(new Error(out?.reason ?? 'No se pudo convertir la especificación OpenAPI'))
        const collection = out.output[0].data as Collection
        collection.info.schema = POSTMAN_SCHEMA_V21
        resolve({ collection: ensureIds(collection), warnings: [] })
      },
    )
  })
}
