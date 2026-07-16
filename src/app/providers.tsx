import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { formatAppError, IpcError } from "@/lib/ipc/commands"
import { toast } from "@/stores/toast.store"

function errorMessage(err: unknown): string {
  if (err instanceof IpcError) return formatAppError(err.appError)
  if (err instanceof Error) return err.message
  return String(err)
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            // Skip if the mutation already handled the error visually.
            if (mutation.meta?.suppressToast) return
            toast.error("Action failed", errorMessage(error))
          },
        }),
      }),
  )

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        {children}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
