import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import { fdate, today } from '@/lib/format'
import type { Task } from '@/types'
import { fetchMyTasks, myTasksKey, setTaskDone, tasksKey } from './api'

/**
 * "Meine Aufgaben" auf dem Dashboard. Abgehakt wird hier – die Vorstandsübersicht
 * unter /aufgaben zeigt denselben Stand, aber nur lesend.
 */
export function MyTasksCard() {
  const { tenant, member: me } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const memberId = me?.id ?? ''

  const { data: tasks = [], isPending } = useQuery({
    queryKey: myTasksKey(memberId),
    queryFn: () => fetchMyTasks(tenantId, memberId),
    enabled: Boolean(tenantId && memberId),
  })

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => setTaskDone(id, done),
    onSuccess: async (_d, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myTasksKey(memberId) }),
        queryClient.invalidateQueries({ queryKey: tasksKey(tenantId) }),
      ])
      toast(vars.done ? 'Aufgabe erledigt – danke!' : 'Aufgabe wieder offen')
    },
    onError: (e: Error) => toastError(`Nicht gespeichert: ${e.message}`),
  })

  const iso = today()

  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      ),
    [tasks],
  )

  const isOverdue = (t: Task) => !t.done && t.due_date !== null && t.due_date < iso

  return (
    <div className="card">
      <h3>✅ Meine Aufgaben</h3>

      {isPending ? (
        <p className="meta">Wird geladen…</p>
      ) : sorted.length === 0 ? (
        <p className="meta">Keine Aufgaben zugeteilt – genieß die Ruhe! 🎉</p>
      ) : (
        sorted.map((t) => (
          <div className="list-item" key={t.id}>
            <input
              type="checkbox"
              checked={t.done}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })}
              style={{ marginTop: 5, accentColor: 'var(--pine)' }}
            />
            <div className={t.done ? 'task-done' : ''}>
              <b>{t.title}</b>
              <div className="meta">
                {t.due_date ? `fällig ${fdate(t.due_date)}` : 'ohne Fälligkeit'}
                {isOverdue(t) && (
                  <span className="pill red" style={{ marginLeft: 6 }}>
                    überfällig
                  </span>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
