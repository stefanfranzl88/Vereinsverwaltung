import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/context'
import { useToast } from '@/components/Toast'
import type { Survey } from '@/types'
import {
  createSurvey,
  fetchActiveMemberCount,
  fetchMyVotes,
  fetchOptions,
  fetchResults,
  fetchSurveys,
  myVotesKey,
  optionsKey,
  resultsKey,
  setSurveyOpen,
  surveysKey,
  vote,
} from './api'
import { SurveyDialog } from './SurveyDialog'

export function UmfragenPage() {
  const { tenant, member: me, can } = useAuth()
  const { toast, toastError } = useToast()
  const queryClient = useQueryClient()

  const tenantId = tenant?.id ?? ''
  const memberId = me?.id ?? ''
  const mayCreate = can('survey.create')

  const [dialogOpen, setDialogOpen] = useState(false)

  const surveysQuery = useQuery({
    queryKey: surveysKey(tenantId),
    queryFn: () => fetchSurveys(tenantId),
    enabled: Boolean(tenantId),
  })
  const optionsQuery = useQuery({
    queryKey: optionsKey(tenantId),
    queryFn: fetchOptions,
    enabled: Boolean(tenantId),
  })
  const resultsQuery = useQuery({
    queryKey: resultsKey(tenantId),
    queryFn: fetchResults,
    enabled: Boolean(tenantId),
  })
  const myVotesQuery = useQuery({
    queryKey: myVotesKey(memberId),
    queryFn: () => fetchMyVotes(memberId),
    enabled: Boolean(memberId),
  })
  const activeCountQuery = useQuery({
    queryKey: ['active-member-count', tenantId],
    queryFn: fetchActiveMemberCount,
    enabled: Boolean(tenantId),
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: surveysKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: optionsKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: resultsKey(tenantId) }),
      queryClient.invalidateQueries({ queryKey: myVotesKey(memberId) }),
    ])

  const voteM = useMutation({
    mutationFn: ({ surveyId, optionId }: { surveyId: string; optionId: string }) =>
      vote(surveyId, optionId),
    onSuccess: async () => {
      await refresh()
      toast('Stimme gezählt')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const createM = useMutation({
    mutationFn: ({ question, options }: { question: string; options: string[] }) =>
      createSurvey(question, options),
    onSuccess: async () => {
      await refresh()
      setDialogOpen(false)
      toast('Umfrage erstellt')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const toggleM = useMutation({
    mutationFn: ({ id, open }: { id: string; open: boolean }) => setSurveyOpen(id, open),
    onSuccess: async (_d, vars) => {
      await refresh()
      toast(vars.open ? 'Umfrage wieder geöffnet' : 'Umfrage beendet')
    },
    onError: (e: Error) => toastError(e.message),
  })

  const surveys = surveysQuery.data ?? []
  const options = useMemo(() => optionsQuery.data ?? [], [optionsQuery.data])
  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data])
  const myVotes = myVotesQuery.data ?? new Map<string, string>()
  const activeCount = activeCountQuery.data ?? 0

  const optionsBySurvey = useMemo(() => {
    const map = new Map<string, typeof options>()
    for (const o of options) {
      const list = map.get(o.survey_id) ?? []
      list.push(o)
      map.set(o.survey_id, list)
    }
    return map
  }, [options])

  const votesByOption = useMemo(
    () => new Map(results.map((r) => [r.option_id, r.votes])),
    [results],
  )

  const error = surveysQuery.error ?? optionsQuery.error ?? resultsQuery.error
  if (error) {
    return (
      <>
        <h2 className="view-title">Umfragen</h2>
        <div className="error-box">Umfragen konnten nicht geladen werden: {error.message}</div>
      </>
    )
  }

  const renderSurvey = (s: Survey) => {
    const opts = optionsBySurvey.get(s.id) ?? []
    const myOption = myVotes.get(s.id)
    const hasVoted = myOption !== undefined

    const totalVotes = opts.reduce((n, o) => n + (votesByOption.get(o.id) ?? 0), 0)
    // Nenner für die Prozentbalken: mindestens 1, sonst Division durch 0.
    const denominator = Math.max(1, totalVotes)

    // Ergebnisse zeigen, sobald man abgestimmt hat – oder wenn die Umfrage
    // beendet ist. Vorher würde die Anzeige die eigene Wahl beeinflussen.
    const showResults = hasVoted || !s.is_open

    return (
      <div className="card" key={s.id}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{s.question}</h3>
          <div className="row" style={{ gap: 8 }}>
            <span className={`pill ${s.is_open ? 'green' : 'grey'}`}>
              {s.is_open ? 'laufend' : 'beendet'}
            </span>
            {mayCreate && (
              <button
                className="btn ghost small"
                disabled={toggleM.isPending}
                onClick={() => toggleM.mutate({ id: s.id, open: !s.is_open })}
              >
                {s.is_open ? '✔ Beenden' : '↩ Wieder öffnen'}
              </button>
            )}
          </div>
        </div>

        {opts.map((o) => {
          const votes = votesByOption.get(o.id) ?? 0
          const percent = Math.round((votes / denominator) * 100)

          if (showResults) {
            return (
              <div key={o.id} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14 }}>
                    {o.label}
                    {myOption === o.id && (
                      <>
                        {' · '}
                        <b>deine Stimme</b>
                      </>
                    )}
                  </span>
                  <span className="mono" style={{ fontSize: 13 }}>
                    {votes} ({percent} %)
                  </span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )
          }

          return (
            <button
              key={o.id}
              className="btn ghost small"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 8,
              }}
              disabled={voteM.isPending || !me}
              onClick={() => voteM.mutate({ surveyId: s.id, optionId: o.id })}
            >
              ○ {o.label}
            </button>
          )
        })}

        <p className="meta">
          {totalVotes} von {activeCount} aktiven Mitgliedern haben abgestimmt
          {s.is_open && !hasVoted && ' · deine Stimme fehlt noch'}
        </p>
      </div>
    )
  }

  return (
    <>
      <h2 className="view-title">Umfragen</h2>
      <p className="view-sub">
        Jede Person hat eine Stimme pro Umfrage · die Abstimmung ist geheim – niemand sieht, wer
        wie gestimmt hat
      </p>

      {mayCreate && (
        <button className="btn small" style={{ marginBottom: 14 }} onClick={() => setDialogOpen(true)}>
          + Umfrage erstellen
        </button>
      )}

      {surveysQuery.isPending ? (
        <p className="meta">Wird geladen…</p>
      ) : surveys.length === 0 ? (
        <div className="card">
          <p className="meta">Noch keine Umfragen.</p>
        </div>
      ) : (
        surveys.map(renderSurvey)
      )}

      {dialogOpen && (
        <SurveyDialog
          saving={createM.isPending}
          onSave={(question, options) => createM.mutate({ question, options })}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}
