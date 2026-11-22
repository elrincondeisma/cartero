declare module 'postman-collection';
declare module 'postman-code-generators' {
  const codegen: {
    getLanguageList(): { key: string; label: string; syntax_mode: string; variants: { key: string }[] }[]
    convert(lang: string, variant: string, request: any, options: Record<string, any>, cb: (err: Error | null, snippet: string) => void): void
  }
  export default codegen
}
