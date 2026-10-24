import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Chip } from '../ui/kit'
import { ago, clock, fullName, isManager, until, when } from '../domain/clinical'
import type { Alert } from '../domain/types'

/** Unanswered alerts move to the next nurse in line after this many minutes. */
const ESCALATE_AFTER = 10

export function Alerts() {
  const { s, act, go, staff, me } = useApp()
  const [show, setShow] = useState<'active' | 'closed'>('active')
  const list = s.alerts
    .filter((a) => (show === 'active' ? a.status !== 'resolved' : a.status === 'resolved'))
    .sort((a, b) => sev(a) - sev(b) || b.t - a.t)
  const canClose = me?.role === 'RN' || isManager(me?.role)
  return (
    <div className="page">
      <div className="row wrap">
        <div className="seg" role="group" aria-label="Show alerts">
          <button aria-pressed={show === 'active'} onClick={() => setShow('active')}>Active ({s.alerts.filter((a) => a.status !== 'resolved').length})</button>
          <button aria-pressed={show === 'closed'} onClick={() => setShow('closed')}>Closed ({s.alerts.filter((a) => a.status === 'resolved').length})</button>
        </div>
        <span className="spacer" />
        <span className="small muted">Unacknowledged alerts go to the next nurse after {ESCALATE_AFTER} minutes.</span>
      </div>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="list">
          {list.length === 0 && <div className="empty">{show === 'active' ? 'No active alerts.' : 'Nothing closed yet.'}</div>}
          {list.map((a) => {
            const r = a.rid ? s.residents.find((x) => x.id === a.rid) : null
            const tone = a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'caution'
            const escalated = a.status === 'open' && s.now - a.t > ESCALATE_AFTER && a.t > s.now - 600
            return (
              <div className="alert-row" key={a.id}>
                <span className={`sev-bar ${tone}`} />
                {r ? <Avatar id={r.id} name={r.name} size={44} /> : <span className="med-icon"><Icon name="bell" /></span>}
                <div className="grow">
                  <div className="row wrap" style={{ gap: 8 }}>
                    <b>{a.title}</b>
                    <Chip tone={tone}>{a.severity === 'high' ? 'Urgent' : a.severity === 'medium' ? 'Soon' : 'For info'}</Chip>
                    {a.status === 'ack' && <Chip tone="ok" icon="check">Acknowledged by {staff(a.ackBy)?.short}</Chip>}
                    {escalated && <Chip tone="critical" icon="fwd">Escalated to {staff('s-mary')?.short}</Chip>}
                  </div>
                  {r && <div className="small strong" style={{ marginTop: 2 }}>{fullName(r)} · {r.bed}</div>}
                  <div className="detail">{a.detail}</div>
                  <div className="meta">
                    <span>Raised {when(a.t, s.day)} ({ago(a.t, s.now)})</span>
                    {a.dueT && a.status !== 'resolved' && <span style={{ color: a.dueT < s.now ? 'var(--crit)' : undefined, fontWeight: 650 }}>{a.dueLabel ?? 'Due'} {a.dueT - s.now > 720 ? when(a.dueT, s.day).replace(/^Tomorrow/, 'tomorrow') : clock(a.dueT)} · {until(a.dueT, s.now)}</span>}
                    {a.status === 'resolved' && <span>Closed {a.resolvedT !== undefined ? when(a.resolvedT, s.day) : ''} by {staff(a.resolvedBy)?.short}</span>}
                  </div>
                </div>
                <div className="row wrap" style={{ justifyContent: 'flex-end', maxWidth: 260 }}>
                  {r && <button className="btn sm" onClick={() => go({ view: 'resident', rid: r.id, tab: a.kind === 'news2' ? 'vitals' : a.kind === 'assessment' ? 'assess' : a.kind === 'skin' ? 'wounds' : a.kind === 'transcription' ? 'meds' : 'overview' })}>Open</button>}
                  {a.status === 'open' && <button className="btn sm primary" onClick={() => act('alert.ack', { id: a.id }, { success: 'Acknowledged. You own this alert.' })}>Acknowledge</button>}
                  {a.status !== 'resolved' && canClose && <button className="btn sm ghost" onClick={() => act('alert.resolve', { id: a.id }, { success: 'Alert closed.' })}>Close</button>}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

const sev = (a: Alert) => (a.status === 'open' ? 0 : 3) + (a.severity === 'high' ? 0 : a.severity === 'medium' ? 1 : 2)
