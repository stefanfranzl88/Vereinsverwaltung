import { supabase } from '@/lib/supabase'
import type { Survey, SurveyOption, SurveyResult } from '@/types'

export const surveysKey = (tenantId: string) => ['surveys', tenantId] as const
export const optionsKey = (tenantId: string) => ['survey-options', tenantId] as const
export const resultsKey = (tenantId: string) => ['survey-results', tenantId] as const
export const myVotesKey = (memberId: string) => ['my-votes', memberId] as const

export async function fetchSurveys(tenantId: string): Promise<Survey[]> {
  const { data, error } = await supabase
    .from('surveys')
    .select('id, tenant_id, question, is_open, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<Survey[]>()

  if (error) throw error
  return data ?? []
}

export async function fetchOptions(): Promise<SurveyOption[]> {
  const { data, error } = await supabase
    .from('survey_options')
    .select('id, survey_id, label, sort_order')
    .order('sort_order')
    .returns<SurveyOption[]>()

  if (error) throw error
  return data ?? []
}

/**
 * Ergebnisse als reine Zahlen. Läuft über survey_results(), NICHT über eine
 * Abfrage auf survey_votes – aus der Tabelle darf jeder nur die eigene Stimme
 * lesen. Sonst wäre über die API auslesbar, wer wie gestimmt hat.
 */
export async function fetchResults(): Promise<SurveyResult[]> {
  const { data, error } = await supabase.rpc('survey_results')
  if (error) throw error

  return ((data ?? []) as SurveyResult[]).map((r) => ({
    survey_id: r.survey_id,
    option_id: r.option_id,
    votes: Number(r.votes),
  }))
}

/** Die eigenen Stimmen: survey_id → option_id. RLS liefert nur die eigenen. */
export async function fetchMyVotes(memberId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('survey_votes')
    .select('survey_id, option_id')
    .eq('member_id', memberId)
    .returns<{ survey_id: string; option_id: string }[]>()

  if (error) throw error
  return new Map((data ?? []).map((v) => [v.survey_id, v.option_id]))
}

export async function vote(surveyId: string, optionId: string): Promise<void> {
  const { error } = await supabase.rpc('vote_survey', {
    p_survey_id: surveyId,
    p_option_id: optionId,
  })
  if (error) throw error
}

export async function createSurvey(question: string, options: string[]): Promise<void> {
  const { error } = await supabase.rpc('create_survey', {
    p_question: question,
    p_options: options,
  })
  if (error) throw error
}

export async function setSurveyOpen(surveyId: string, open: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_survey_open', {
    p_survey_id: surveyId,
    p_open: open,
  })
  if (error) throw error
}

/** Wie viele aktive Mitglieder gibt es? Für "x von y haben abgestimmt". */
export async function fetchActiveMemberCount(): Promise<number> {
  const { data, error } = await supabase.rpc('active_member_count')
  if (error) throw error
  return Number(data ?? 0)
}
