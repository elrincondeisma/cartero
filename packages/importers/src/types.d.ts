declare module 'postman-collection-transformer' {
  const transformer: {
    convert(input: any, options: { inputVersion: string; outputVersion: string; retainIds?: boolean }, cb: (err: Error | null, out: any) => void): void
    normalize(input: any, options: any, cb: (err: Error | null, out: any) => void): void
  }
  export default transformer
}
declare module 'openapi-to-postmanv2' {
  const converter: {
    convert(input: { type: 'string' | 'json' | 'file'; data: any }, options: Record<string, any>, cb: (err: Error | null, out: any) => void): void
  }
  export default converter
}
