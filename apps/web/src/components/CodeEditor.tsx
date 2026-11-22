import Editor, { type OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import { useRef } from 'react'
import { PM_TYPES } from '@/lib/pm-types'
import { useUi } from '@/store/ui'

// Monaco empaquetado localmente (sin CDN): funciona en despliegues sin Internet
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    if (label === 'html' || label === 'handlebars') return new HtmlWorker()
    if (label === 'css') return new CssWorker()
    return new EditorWorker()
  },
}
loader.config({ monaco })

let configured = false
function configure() {
  if (configured) return
  configured = true
  // Monaco ≥ 0.55: las APIs de lenguaje viven en monaco.typescript / monaco.json
  const js = monaco.typescript.javascriptDefaults
  js.setCompilerOptions({ target: monaco.typescript.ScriptTarget.ES2020, allowNonTsExtensions: true, checkJs: false, lib: ['es2020'] })
  js.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
  js.addExtraLib(PM_TYPES, 'ts:cartero/pm.d.ts')
  monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore' })
}

export interface CodeEditorProps {
  value: string
  onChange?: (v: string) => void
  language?: string
  readOnly?: boolean
  height?: string | number
  minimal?: boolean
  wordWrap?: boolean
  onMount?: OnMount
  path?: string
}

export function CodeEditor({ value, onChange, language = 'plaintext', readOnly, height = '100%', minimal, wordWrap = true, onMount, path }: CodeEditorProps) {
  const theme = useUi((s) => s.theme)
  const ref = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      path={path}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      beforeMount={configure}
      onMount={(editor, m) => {
        ref.current = editor
        onMount?.(editor, m)
      }}
      onChange={(v) => onChange?.(v ?? '')}
      loading={<div className="p-3 text-muted">Cargando editor…</div>}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        lineNumbers: minimal ? 'off' : 'on',
        folding: !minimal,
        scrollBeyondLastLine: false,
        wordWrap: wordWrap ? 'on' : 'off',
        tabSize: 2,
        automaticLayout: true,
        renderLineHighlight: readOnly ? 'none' : 'line',
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        overviewRulerLanes: 0,
        glyphMargin: false,
        lineDecorationsWidth: minimal ? 8 : 10,
        quickSuggestions: language === 'javascript',
        fixedOverflowWidgets: true,
      }}
    />
  )
}
