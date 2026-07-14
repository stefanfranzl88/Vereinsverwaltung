import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface ToastMessage {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface ToastApi {
  toast: (text: string) => void
  toastError: (text: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast muss innerhalb von <ToastProvider> verwendet werden')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  const push = useCallback((text: string, kind: 'info' | 'error') => {
    const id = Date.now() + Math.random()
    setMessages((prev) => [...prev, { id, text, kind }])
    setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 2400)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      toast: (text) => push(text, 'info'),
      toastError: (text) => push(text, 'error'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {messages.map((m, i) => (
        <div
          key={m.id}
          className={`toast${m.kind === 'error' ? ' error' : ''}`}
          role="status"
          style={{ bottom: 84 + i * 52 }}
        >
          {m.text}
        </div>
      ))}
    </ToastContext.Provider>
  )
}
