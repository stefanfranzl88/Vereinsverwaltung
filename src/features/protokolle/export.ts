import { fdate, ftime, fullName } from '@/lib/format'
import type { Member, Protocol, Task } from '@/types'

/**
 * Protokoll als reine Textdatei – so wie im Prototyp.
 * BOM voran, damit Editoren unter Windows die Umlaute richtig lesen.
 */
export function exportProtocolTxt(
  protocol: Protocol,
  attendees: Member[],
  tasks: Task[],
  members: Member[],
  tenantName: string,
): void {
  const memberName = (id: string | null) => {
    const m = members.find((x) => x.id === id)
    return m ? fullName(m) : '–'
  }

  const time = protocol.time_from
    ? `   Zeit: ${ftime(protocol.time_from)} – ${ftime(protocol.time_to) ?? '?'} Uhr`
    : ''

  const lines: string[] = [
    tenantName.toUpperCase(),
    '='.repeat(42),
    '',
    `PROTOKOLL: ${protocol.title}`,
    `Art: ${protocol.proto_type}   Sichtbarkeit: ${
      protocol.visibility === 'alle' ? 'alle Mitglieder' : 'nur Vorstand'
    }`,
    `Datum: ${fdate(protocol.proto_date)}${time}`,
  ]

  if (protocol.location) lines.push(`Ort: ${protocol.location}`)
  lines.push(
    `Schriftführung: ${protocol.members ? `${protocol.members.first_name} ${protocol.members.last_name}` : '–'}`,
    '',
    `ANWESEND (${attendees.length}): ${attendees.map(fullName).join(', ') || '–'}`,
    '',
    '-'.repeat(42),
    '',
    protocol.body ?? '',
    '',
  )

  if (tasks.length > 0) {
    lines.push('-'.repeat(42), '', 'AUFGABENVERTEILUNG:')
    for (const t of tasks) {
      lines.push(
        `• ${t.title} – ${memberName(t.assignee_id)}` +
          (t.due_date ? ` (fällig ${fdate(t.due_date)})` : ' (ohne Fälligkeit)') +
          (t.done ? ' [erledigt]' : ''),
      )
    }
  }

  const slug = protocol.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_')
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' })

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `protokoll_${protocol.proto_date}_${slug}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
