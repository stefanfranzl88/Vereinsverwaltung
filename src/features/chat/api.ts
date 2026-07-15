import { supabase } from '@/lib/supabase'
import type { ChatMessage } from '@/types'

export const chatKey = (tenantId: string) => ['chat', tenantId] as const

/** Neueste zuletzt: aufsteigend nach Zeit, damit unten die frischeste steht. */
export async function fetchMessages(tenantId: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, tenant_id, member_id, body, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<ChatMessage[]>()

  if (error) throw error
  // Neueste-zuerst geladen (wegen limit), für die Anzeige wieder umdrehen.
  return (data ?? []).reverse()
}

/** Gibt die angelegte Zeile zurück, damit der Absender sie sofort sieht. */
export async function sendMessage(
  tenantId: string,
  memberId: string,
  body: string,
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ tenant_id: tenantId, member_id: memberId, body })
    .select('id, tenant_id, member_id, body, created_at')
    .single<ChatMessage>()

  if (error) throw error
  return data
}

export async function deleteMessage(id: string): Promise<void> {
  const { error } = await supabase.from('chat_messages').delete().eq('id', id)
  if (error) throw error
}
