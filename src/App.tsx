import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequireAccess, RequireAuth } from '@/auth/RequireAuth'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { MembersPage } from '@/features/members/MembersPage'
import { RolesMatrixPage } from '@/features/roles/RolesMatrixPage'
import { EventsPage } from '@/features/events/EventsPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { KassaPage } from '@/features/kassa/KassaPage'
import { InvoicesPage } from '@/features/invoices/InvoicesPage'
import { BigEventsPage } from '@/features/bigevents/BigEventsPage'
import { InventarPage } from '@/features/inventar/InventarPage'
import { ProtokollePage } from '@/features/protokolle/ProtokollePage'
import { MitarbeitPage } from '@/features/mitarbeit/MitarbeitPage'
import { UmfragenPage } from '@/features/umfragen/UmfragenPage'
import { SchluesselPage } from '@/features/schluessel/SchluesselPage'
import { DokumentePage } from '@/features/dokumente/DokumentePage'

/**
 * Noch nicht gebaute Module. Der Nav-Eintrag ist bereits modul-gegated,
 * die Seite selbst kommt in den nächsten Schritten.
 */
function Soon({ title }: { title: string }) {
  return (
    <>
      <h2 className="view-title">{title}</h2>
      <p className="view-sub">Dieses Modul ist noch nicht umgesetzt.</p>
      <div className="notice">
        Freigeschaltet und sichtbar – der Inhalt folgt im nächsten Ausbauschritt.
      </div>
    </>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route
          path="mitglieder"
          element={
            <RequireAccess module="core">
              <MembersPage />
            </RequireAccess>
          }
        />

        <Route
          path="kassa"
          element={
            <RequireAccess module="kassa" perm="kassa.view">
              <KassaPage />
            </RequireAccess>
          }
        />
        <Route
          path="termine"
          element={
            <RequireAccess module="core">
              <EventsPage />
            </RequireAccess>
          }
        />
        <Route
          path="events"
          element={
            <RequireAccess module="events">
              <BigEventsPage />
            </RequireAccess>
          }
        />
        <Route
          path="inventar"
          element={
            <RequireAccess module="inventar">
              <InventarPage />
            </RequireAccess>
          }
        />
        <Route
          path="protokolle"
          element={
            <RequireAccess module="core">
              <ProtokollePage />
            </RequireAccess>
          }
        />
        <Route
          path="aufgaben"
          element={
            <RequireAccess module="core" perm="tasks.viewall">
              <TasksPage />
            </RequireAccess>
          }
        />
        <Route
          path="mitarbeit"
          element={
            <RequireAccess module="mitarbeit">
              <MitarbeitPage />
            </RequireAccess>
          }
        />
        <Route
          path="umfragen"
          element={
            <RequireAccess module="umfragen">
              <UmfragenPage />
            </RequireAccess>
          }
        />
        <Route
          path="rechnungen"
          element={
            <RequireAccess module="kassa">
              <InvoicesPage />
            </RequireAccess>
          }
        />
        <Route
          path="chat"
          element={
            <RequireAccess module="chat">
              <Soon title="Vereins-Chat" />
            </RequireAccess>
          }
        />
        <Route
          path="dokumente"
          element={
            <RequireAccess module="dokumente" perm="docs.view">
              <DokumentePage />
            </RequireAccess>
          }
        />
        <Route
          path="schluessel"
          element={
            <RequireAccess module="schluessel" perm="keys.view">
              <SchluesselPage />
            </RequireAccess>
          }
        />
        <Route
          path="rollen"
          element={
            <RequireAccess module="core" perm="roles.view">
              <RolesMatrixPage />
            </RequireAccess>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
