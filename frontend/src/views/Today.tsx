import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Chip, Score } from '../ui/kit'
import { age, clock, currentSlot, until, when } from '../domain/clinical'
import { activeAlerts, news2Chip, nextDoses, nowQueue, openTasks, riskChips, roundProgress, shiftNow } from '../domain/selectors'
import type { Resident } from '../domain/types'

export function Today() {
  const { s, go, me } = useApp()
  const slot = currentSlot(s)
  const prog = roundProgress(s, slot)
  const queue = nowQueue(s)
  const shift = shiftNow(s.now)
  const alerts = activeAlerts(s)
  const openAlerts = alerts.filter((a) => a.status === 'open')
  const tasksSoon = openTasks(s).filter((t) => t.due <= s.now + 60 && !t.assessment)
  const overdueTasks = tasksSoon.filter((t) => t.due < s.now)
  const [showAll, setShowAll] = useState(false)
  const greeting = s.now % 1440 < 720 ? 'Good morning' : s.now % 1440 < 1080 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="page">
      <div className="section-h" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="eyebrow">{shift.label} · {clock(shift.start)}–{clock(shift.end)}</div>
          <h2 style={{ fontSize: 26, marginTop: 4 }}>{greeting}, {me?.short}</h2>
        </div>
      </div>

      <div className="today-strip">
        <div className="card stat-card round-card">
          <div className="row">
            <span className="eyebrow" style={{ color: '#c9d8ff' }}>{slot} medication round</span>
            <span className="spacer" />
            <span className="small muted">{prog.total - prog.done} to go</span>
          </div>
          <div className="big">{prog.done}<small style={{ color: '#c9d8ff' }}> of {prog.total} doses</small></div>
          <div className="progress" aria-label={`${prog.done} of ${prog.total} doses recorded`}>
            <i style={{ width: `${(prog.given / Math.max(prog.total, 1)) * 100}%` }} />
            <i className="held" style={{ width: `${(prog.other / Math.max(prog.total, 1)) * 100}%`, background: '#fcd9a8' }} />
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn" onClick={() => go({ view: 'round' })}><Icon name="pill" />{prog.done ? 'Continue round' : 'Start round'}</button>
          </div>
        </div>
        <button className="card stat-card" style={{ textAlign: 'left' }} onClick={() => go({ view: 'alerts' })}>
          <span className="eyebrow">Alerts</span>
          <div className="big" style={{ color: openAlerts.length ? 'var(--crit)' : undefined }}>{openAlerts.length}<small> open</small></div>
          <span className="small muted">{alerts.length - openAlerts.length} acknowledged and being watched</span>
        </button>
        <div className="card stat-card">
          <span className="eyebrow">Care tasks, next hour</span>
          <div className="big">{tasksSoon.length}</div>
          <span className="small" style={{ color: overdueTasks.length ? 'var(--warn-ink)' : 'var(--muted)', fontWeight: overdueTasks.length ? 650 : 400 }}>
            {overdueTasks.length ? `${overdueTasks.length} overdue` : 'None overdue'}
          </span>
        </div>
        <button className="card stat-card" style={{ textAlign: 'left' }} onClick={() => go({ view: 'handover' })}>
          <span className="eyebrow">Handover to {shift.next}</span>
          <div className="big">{clock(shift.end)}</div>
          <span className="small muted">{until(shift.end, s.now)}</span>
        </button>
      </div>

      <section className="card now-list">
        <div className="card-h">
          <h3>Needs you now</h3>
          <Chip tone={queue.some((q) => q.tone === 'critical') ? 'critical' : 'accent'}>{queue.length}</Chip>
          <span className="spacer" />
          <span className="small muted hide-sm">Most urgent first</span>
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {queue.length === 0 && <div className="empty">Nothing urgent. The ward is on track.</div>}
          {(showAll ? queue : queue.slice(0, 6)).map((q) => {
            const r = q.rid ? s.residents.find((x) => x.id === q.rid) : null
            return (
              <div className="now-row" key={q.key}>
                <span className={`sev-bar ${q.tone}`} />
                {r ? <Avatar id={r.id} name={r.name} size={40} /> : <span className="med-icon"><Icon name="bell" /></span>}
                <div className="why">
                  <b>{q.title}</b>
                  <span>{q.detail}</span>
                </div>
                {q.due !== undefined && (
                  <span className="when num" style={{ color: q.due < s.now ? 'var(--crit)' : 'var(--ink-2)' }}>
                    {q.due - s.now > 720 ? when(q.due, s.day) : clock(q.due)}<br /><span className="muted" style={{ fontWeight: 600 }}>{until(q.due, s.now)}</span>
                  </span>
                )}
                <button
                  className={`btn sm ${q.tone === 'critical' ? 'primary' : ''}`}
                  onClick={() => (q.action.to === 'resident' && q.rid ? go({ view: 'resident', rid: q.rid, tab: q.action.tab }) : go({ view: q.action.to as 'round' | 'alerts' | 'incidents' }))}
                >
                  {q.action.label}
                </button>
              </div>
            )
          })}
          {queue.length > 6 && (
            <button className="btn ghost" style={{ borderRadius: 0, minHeight: 48 }} onClick={() => setShowAll((x) => !x)}>
              {showAll ? 'Show fewer' : `Show all ${queue.length}`}
            </button>
          )}
        </div>
      </section>

      <section className="stack">
        <div className="section-h">
          <h2>Beds</h2>
          <span className="muted small">{s.ward.name}</span>
        </div>
        <BedGrid residents={s.residents} />
      </section>
    </div>
  )
}

export function BedGrid({ residents }: { residents: Resident[] }) {
  const { s, go } = useApp()
  return (
    <div className="bed-grid">
      {residents.map((r) => {
        const news = news2Chip(s, r.id)
        const nd = nextDoses(s, r.id)
        const tasks = openTasks(s, r.id).filter((t) => t.due <= s.now + 120)
        const alerts = activeAlerts(s, r.id).filter((a) => a.kind !== 'hospital')
        const away = r.status !== 'in'
        return (
          <button key={r.id} className={`bed${away ? ' away' : ''}`} onClick={() => go({ view: 'resident', rid: r.id })}>
            <div className="bed-top">
              <Avatar id={r.id} name={r.name} size={46} dim={away} />
              <div className="grow">
                <div className="bed-tag">{r.bed}</div>
                <div className="bed-name">{r.salutation} {r.name}</div>
                <div className="bed-meta">{age(r.dob, s.day)} · {r.sex === 'F' ? 'Female' : 'Male'} · {r.languages[0]}</div>
              </div>
              {news && !away && <Score value={news.value} tone={news.tone} label={`NEWS2 ${news.value}`} />}
            </div>
            <div className="bed-chips">
              {away && <Chip tone="accent" icon="bed">In hospital</Chip>}
              {r.allergies.filter((a) => a.type === 'allergy').map((a) => <Chip key={a.substance} tone="critical" icon="alert">{a.substance}</Chip>)}
              {r.acp.resus === 'Do not attempt CPR' && <Chip tone="hi">DNACPR</Chip>}
              {riskChips(s, r.id).map((c) => <Chip key={c.label} tone={c.tone} icon={c.icon}>{c.label}</Chip>)}
              {r.flags.includes('new') && <Chip tone="accent">New admission</Chip>}
              {r.stay && <Chip tone="accent" icon="clock">Respite to {new Date(r.stay.to).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</Chip>}
              {r.flags.includes('dysphagia') && <Chip tone="caution">IDDSI 2 fluids</Chip>}
            </div>
            <div className="bed-foot">
              <div>
                <span className="muted">Medicines</span>
                {away ? <b className="muted">Suspended</b> : nd?.slot ? (
                  <b style={{ color: nd.overdue ? 'var(--crit)' : undefined }}>{nd.slot} · {nd.count} due</b>
                ) : <b style={{ color: 'var(--ok-ink)' }}>All done today</b>}
              </div>
              <div>
                <span className="muted">Care</span>
                <b style={{ color: alerts.some((a) => a.severity === 'high') ? 'var(--crit)' : undefined }}>
                  {alerts.length ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : tasks.length ? `${tasks.length} task${tasks.length > 1 ? 's' : ''} soon` : 'On track'}
                </b>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
