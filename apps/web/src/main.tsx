import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from 'sonner'
import { App } from './App'
import { DialogHost } from './components/dialogs'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e: any) => n < 2 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: false, staleTime: 5_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider>
        <BrowserRouter>
          <App />
          <DialogHost />
          <Toaster position="bottom-right" richColors closeButton theme="system" />
        </BrowserRouter>
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  </StrictMode>,
)
