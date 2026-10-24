import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Chip } from '../ui/kit'
import { clock, fullName, residentOf, when } from '../domain/clinical'
import { activeAlerts, roundProgress } from '../domain/selectors'
import { typeLabel } from '../domain/incidents'
import { IncidentSheet } from './Incidents'
import {
  cdOverview, incidentStats, managerQueue, medSummary, occupancy, onDuty, patterns, reviewsDue, riskRegister, TREND_DAYS, wardSummary, type DayMeds, type RiskCell,
  type WardSummary,
} from '../domain/manager'
import type { Snapshot } from '../domain/types'

export function Manager() {
  const { s, me, go, wards } = useApp()
  const mine = wards.filter((w) => me?.wards.includes(w.id))
  const occ = occupancy(s)
  const duty = onDuty(s)
  const meds = medSummary(s)
  const prog = roundProgress(s, meds.slot)
  const alerts = activeAlerts(s).filter((a) => a.kind !== 'hospital')
  const highOpen = alerts.filter((a) => a.severity === 'high' && a.status === 'open').length
  const queue = managerQueue(s)
  const pats = patterns(s)
  const due = reviewsDue(s)
  const [allDue, setAllDue] = useState(false)
  const [incId, setIncId] = useState<string | null>(null)
  const inc = incidentStats(s)
  const greeting = s.now % 1440 < 720 ? 'Good morning' : s.now % 1440 < 1080 ? 'Good afternoon' : 'Good evening'
  const openRes = (rid: string, tab?: string) => go({ view: 'resident', rid, tab })

  return (
    <div className="page">
      <div className="section-h" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="eyebrow">Nurse manager · {mine.length > 1 ? `${mine.length} wards` : s.ward.name} · {duty.shift.label}</div>
          <h2 style={{ fontSize: 26, marginTop: 4 }}>{greeting}, {me?.short}</h2>
        </div>
        <span className="small muted hide-sm">Live at {clock(s.now)}</span>
      </div>

      {mine.length > 1 && (
        <>
          <YourWards ids={mine.map((w) => w.id)} />
          <div className="section-h ward-detail-h">
            <h3 className="grow">{s.ward.name} in detail</h3>
            <span className="small muted">{s.ward.unit}</span>
          </div>
        </>
      )}

      <div className="mgr-kpis">
        <button className="card stat-card" onClick={() => go({ view: 'residents' })}>
          <span className="eyebrow">Residents</span>
          <div className="big">{occ.living.length}<small> in the home · {occ.beds} beds</small></div>
          <div className="row wrap" style={{ gap: 6 }}>
            {occ.away.length > 0 && <Chip tone="accent" icon="bed">{occ.away.length} in hospital</Chip>}
            {occ.respite.length > 0 && <Chip tone="accent" icon="clock">{occ.respite.length} respite</Chip>}
            {occ.newAdmissions.length > 0 && <Chip tone="accent">{occ.newAdmissions.length} new this week</Chip>}
            {occ.vacant > 0 && <Chip>{occ.vacant} vacant</Chip>}
          </div>
        </button>
        <button className="card stat-card" onClick={() => go({ view: 'alerts' })}>
          <span className="eyebrow">Alerts</span>
          <div className="big" style={{ color: highOpen ? 'var(--crit)' : undefined }}>{alerts.length}<small> active</small></div>
          <span className="small muted">{highOpen ? `${highOpen} high, not acknowledged` : 'All high alerts acknowledged'}</span>
        </button>
        <button className="card stat-card" onClick={() => go({ view: 'round' })}>
          <span className="eyebrow">{meds.slot} round</span>
          <div className="big">{prog.done}<small> of {prog.total} doses</small></div>
          <span className="small" style={{ color: meds.overdue.length ? 'var(--crit)' : 'var(--muted)', fontWeight: meds.overdue.length ? 650 : 400 }}>
            {meds.overdue.length ? `${meds.overdue.length} dose${meds.overdue.length > 1 ? 's' : ''} overdue today` : 'Nothing overdue today'}
          </span>
        </button>
        <div className="card stat-card">
          <span className="eyebrow">On duty, {duty.shift.label}</span>
          <div className="big">{duty.nurses.length}<small> nurse{duty.nurses.length === 1 ? '' : 's'} · {duty.carers.length} care aide{duty.carers.length === 1 ? '' : 's'}</small></div>
          <span className="small muted">{duty.perNurse ? `${duty.perNurse.toFixed(1)} residents per nurse` : 'No nurse on shift'}</span>
        </div>
      </div>

      <div className="mgr-grid">
        <section className="card now-list">
          <div className="card-h">
            <h3>Needs your decision</h3>
            <Chip tone={queue.some((q) => q.tone === 'critical') ? 'critical' : 'accent'}>{queue.length}</Chip>
          </div>
          <div className="list" style={{ marginTop: 10 }}>
            {queue.length === 0 && <div className="empty">Nothing waiting for you.</div>}
            {queue.map((q) => {
              const r = q.rid ? residentOf(s, q.rid) : null
              return (
                <div className="now-row" key={q.key}>
                  <span className={`sev-bar ${q.tone}`} />
                  {r ? <Avatar id={r.id} name={r.name} size={40} dim={r.status !== 'in'} /> : <span className="med-icon"><Icon name="bell" /></span>}
                  <div className="why"><b>{q.title}</b><span>{q.detail}</span></div>
                  <button className="btn sm" onClick={() => (q.incident ? setIncId(q.incident) : q.to === 'resident' && q.rid ? openRes(q.rid, q.tab) : go({ view: q.to as 'alerts' | 'audit' }))}>Open</button>
                </div>
              )
            })}
          </div>
        </section>

        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <div className="card-h"><h3>Team on shift</h3><span className="spacer" /><span className="small muted">{clock(duty.shift.start)}–{clock(duty.shift.end)}</span></div>
            <div className="team">
              {duty.team.map((x) => (
                <div className="team-row" key={x.id}>
                  <Avatar id={x.id} name={x.name} size={34} />
                  <div className="grow"><b>{x.name}</b><span className="small muted">{x.title}</span></div>
                  <Chip tone={x.role === 'RN' || x.role === 'NM' ? 'accent' : undefined}>{x.role}</Chip>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h3>Incidents, 30 days</h3><span className="spacer" /><button className="btn ghost sm" onClick={() => go({ view: 'incidents' })}>All incidents<Icon name="right" size={16} /></button></div>
            <div className="card-b stack" style={{ gap: 10 }}>
              <div className="row wrap" style={{ gap: 18 }}>
                <div><span className="eyebrow">Falls</span><div className="cd-bal num">{inc.falls.length}</div></div>
                <div><span className="eyebrow">With injury</span><div className="cd-bal num">{inc.fallsInjury}</div></div>
                <div><span className="eyebrow">Per 1,000 bed-days</span><div className="cd-bal num">{inc.per1000 === null ? '–' : inc.per1000.toFixed(1)}</div></div>
                <div><span className="eyebrow">Open</span><div className="cd-bal num" style={{ color: inc.open ? 'var(--warn-ink)' : undefined }}>{inc.open}</div></div>
              </div>
              {inc.recent.filter((i) => i.type !== 'fall').length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {Object.entries(inc.recent.filter((i) => i.type !== 'fall').reduce<Record<string, number>>((m, i) => ({ ...m, [typeLabel(i.type)]: (m[typeLabel(i.type)] ?? 0) + 1 }), {})).map(([k, n]) => <Chip key={k}>{k}: {n}</Chip>)}
                </div>
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h3>Controlled drugs</h3><span className="spacer" /><Chip tone="ok" icon="shield">E-register</Chip></div>
            <div className="list" style={{ marginTop: 8 }}>
              {cdOverview(s).length === 0 && <div className="empty">No controlled drugs on this ward.</div>}
              {cdOverview(s).map(({ o, r, balance, unit, last }) => (
                <button className="cd-row" key={o.id} onClick={() => openRes(r.id, 'meds')}>
                  <div className="grow">
                    <b>{o.drug.split(' (')[0]}</b>
                    <span className="small muted">{fullName(r)}{last ? ` · last entry ${when(last.t, s.day)}, ${last.kind}` : ''}</span>
                  </div>
                  <span className="num cd-bal">{balance}<small> {unit}</small></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="mgr-grid wide-left">
        <section className="card">
          <div className="card-h">
            <h3>Medicines, last {TREND_DAYS} days</h3>
            <span className="spacer" />
            <span className="small muted hide-sm">{meds.total} doses recorded</span>
          </div>
          <div className="card-b stack" style={{ gap: 16 }}>
            <div className="mgr-figures">
              <div><span className="eyebrow">Given on time</span><b className="num">{meds.onTimePct ?? '–'}<small>%</small></b></div>
              <div><span className="eyebrow">Given late</span><b className="num">{meds.late}</b></div>
              <div><span className="eyebrow">Held or refused</span><b className="num">{meds.notGiven}</b></div>
              <div><span className="eyebrow">Overdue now</span><b className="num" style={{ color: meds.overdue.length ? 'var(--crit)' : undefined }}>{meds.overdue.length}</b></div>
            </div>
            <MedChart days={meds.trend} />
            <p className="tiny muted">On time means within 60 minutes of the due time, or 30 minutes for time-critical medicines. Controlled drugs are counted in the e-register.</p>
          </div>
        </section>
        <section className="card now-list">
          <div className="card-h"><h3>Patterns to review</h3><Chip tone="accent">{pats.length}</Chip></div>
          <div className="list" style={{ marginTop: 10 }}>
            {pats.length === 0 && <div className="empty">No patterns this week.</div>}
            {pats.map((p) => (
              <button className="now-row as-btn" key={p.key} onClick={() => openRes(p.rid, p.tab)}>
                <span className={`sev-bar ${p.tone}`} />
                <div className="why"><b>{p.title}</b><span>{p.detail}</span></div>
                <Icon name="right" size={18} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <RiskTable />

      <section className="card">
        <div className="card-h">
          <h3>Assessments and reviews due</h3>
          <Chip tone={due.some((d) => d.tone === 'critical') ? 'critical' : 'accent'}>{due.length}</Chip>
          <span className="spacer" />
          <span className="small muted hide-sm">Risk assessments monthly, and within 48 hours of admission</span>
        </div>
        <div className="due-grid">
          {(allDue ? due : due.slice(0, 9)).map((d) => {
            const r = residentOf(s, d.rid)!
            return (
              <button className="due-item" key={d.key} onClick={() => openRes(d.rid, d.tab)}>
                <span className={`sev-bar ${d.tone}`} />
                <div className="grow">
                  <b>{d.what}</b>
                  <span className="small muted">{r.salutation} {r.name} · {r.bed}</span>
                </div>
                <Chip tone={d.tone}>{d.status}</Chip>
              </button>
            )
          })}
        </div>
        {due.length > 9 && (
          <button className="btn ghost" style={{ width: '100%', borderRadius: '0 0 var(--r-lg) var(--r-lg)', minHeight: 48, borderTop: '1px solid var(--line)' }} onClick={() => setAllDue((x) => !x)}>
            {allDue ? 'Show fewer' : `Show all ${due.length}`}
          </button>
        )}
      </section>
      {incId && <IncidentSheet id={incId} onClose={() => setIncId(null)} />}
    </div>
  )
}

/** Every ward the manager covers side by side, with a total for the home. Tap a ward to see it in detail. */
function YourWards({ ids }: { ids: string[] }) {
  const { api, s, setWard } = useApp()
  const [snaps, setSnaps] = useState<Snapshot[]>([s])
  const key = ids.join()
  useEffect(() => {
    let live = true
    // The ward on screen is already loaded; fetch the others whenever it refreshes.
    Promise.all(key.split(',').map((id) => (id === s.ward.id ? Promise.resolve(s) : api.snapshot(id)))).then((x) => { if (live) setSnaps(x) })
    return () => { live = false }
  }, [api, s, key])
  const rows = snaps.map(wardSummary)
  const sum = (f: (w: WardSummary) => number) => rows.reduce((n, w) => n + f(w), 0)
  const onTime = sum((w) => w.onTime), given = sum((w) => w.given)
  return (
    <section className="ward-cards" aria-label="Your wards">
      {rows.map((w) => {
        const here = w.ward.id === s.ward.id
        return (
          <button className={`card ward-card${here ? ' here' : ''}`} key={w.ward.id} aria-pressed={here} onClick={() => setWard(w.ward.id)}>
            <div className="ward-card-h">
              <span className="ward-code">{w.ward.code}</span>
              <div className="grow"><b>{w.ward.name}</b><span className="small muted">{w.ward.unit}</span></div>
              {here ? <Chip tone="accent">Showing</Chip> : <Icon name="right" size={18} className="muted" />}
            </div>
            <div className="ward-figs">
              <Fig label="Decisions" value={w.decisions} tone={w.urgent ? 'crit' : undefined} />
              <Fig label="High alerts" value={w.highOpen} tone={w.highOpen ? 'crit' : undefined} />
              <Fig label="Overdue doses" value={w.overdue.length} tone={w.overdue.length ? 'crit' : undefined} />
              <Fig label="Open incidents" value={w.openIncidents} tone={w.openIncidents ? 'warn' : undefined} />
            </div>
            <div className="ward-lines small">
              <span><Icon name="bed" size={15} />{w.occ.living.length} of {w.occ.beds} beds{w.occ.away.length ? `, ${w.occ.away.length} in hospital` : ''}{w.occ.vacant ? `, ${w.occ.vacant} vacant` : ''}</span>
              <span><Icon name="pill" size={15} />{w.slot} round {w.round.done} of {w.round.total} · {w.onTimePct ?? '–'}% on time this week</span>
              <span><Icon name="user" size={15} />{w.duty.nurses.length} nurse{w.duty.nurses.length === 1 ? '' : 's'}, {w.duty.carers.length} care aide{w.duty.carers.length === 1 ? '' : 's'}{w.duty.perNurse ? ` · ${w.duty.perNurse.toFixed(1)} per nurse` : ''}</span>
              {w.unwell.length > 0 && <span className="crit-ink"><Icon name="heart" size={15} />NEWS2 5 or more: {w.unwell.map((u) => `${u.r.preferred} (${u.score})`).join(', ')}</span>}
            </div>
          </button>
        )
      })}
      <div className="card ward-card total">
        <div className="ward-card-h">
          <span className="ward-code"><Icon name="home" size={18} /></span>
          <div className="grow"><b>All your wards</b><span className="small muted">{s.home.name}</span></div>
        </div>
        <div className="ward-figs">
          <Fig label="Residents in" value={sum((w) => w.occ.living.length)} />
          <Fig label="Vacant beds" value={sum((w) => w.occ.vacant)} />
          <Fig label="On time, 7 days" value={given ? `${Math.round((onTime / given) * 100)}%` : '–'} />
          <Fig label="Falls, 30 days" value={sum((w) => w.falls30)} />
        </div>
      </div>
    </section>
  )
}

function Fig({ label, value, tone }: { label: string; value: number | string; tone?: 'crit' | 'warn' }) {
  return (
    <div className="fig">
      <b className="num" style={{ color: tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn-ink)' : undefined }}>{value}</b>
      <span className="tiny muted">{label}</span>
    </div>
  )
}

function MedChart({ days }: { days: DayMeds[] }) {
  const max = Math.max(...days.map((d) => d.total), 1)
  const segs = [
    { key: 'onTime', label: 'On time', cls: 'ok' },
    { key: 'late', label: 'Late', cls: 'caution' },
    { key: 'notGiven', label: 'Held or refused', cls: 'warn' },
  ] as const
  return (
    <figure className="medchart" aria-label="Doses recorded per day, split by on time, late, and held or refused">
      <div className="medchart-legend">
        {segs.map((g) => <span key={g.key}><i className={g.cls} />{g.label}</span>)}
      </div>
      <div className="medchart-plot">
        {days.map((d) => (
          <div className="medchart-col" key={d.offset} tabIndex={0} aria-label={`${d.label}: ${d.onTime} on time, ${d.late} late, ${d.notGiven} held or refused`}>
            <div className="medchart-bar" style={{ height: `${(d.total / max) * 100}%` }}>
              {[...segs].reverse().map((g) => d[g.key] > 0 && <i key={g.key} className={g.cls} style={{ flexGrow: d[g.key] }} />)}
            </div>
            <div className="medchart-tip" role="tooltip">
              <b>{d.label}</b>
              {segs.map((g) => <span key={g.key}><i className={g.cls} />{g.label} <b className="num">{d[g.key]}</b></span>)}
            </div>
            <span className="medchart-x">{d.label}</span>
            <span className="medchart-n num">{d.total}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

function RiskTable() {
  const { s, go } = useApp()
  const rows = riskRegister(s)
  const cell = (c: RiskCell | null) => (c ? <Chip tone={c.tone === 'ok' ? undefined : c.tone} title={c.title}>{c.label}</Chip> : <span className="tiny muted">Not done</span>)
  return (
    <section className="card">
      <div className="card-h">
        <h3>Clinical risk across the ward</h3>
        <span className="spacer" />
        <span className="small muted hide-sm">Highest risk first · tap a resident to open</span>
      </div>
      <div className="mar-wrap" style={{ marginTop: 10 }}>
        <table className="mar risk">
          <thead>
            <tr><th>Resident</th><th>NEWS2</th><th>Falls</th><th>Pressure injury</th><th>Nutrition</th><th>Pain</th><th>Wounds</th><th>Alerts</th></tr>
          </thead>
          <tbody>
            {rows.map(({ r, news2, cells, wound, alerts }) => (
              <tr key={r.id} className={r.status !== 'in' ? 'away' : undefined} onClick={() => go({ view: 'resident', rid: r.id })} tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && go({ view: 'resident', rid: r.id })}>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <Avatar id={r.id} name={r.name} size={32} dim={r.status !== 'in'} />
                    <div><b>{r.salutation} {r.name}</b><div className="tiny muted">{r.bed}{r.status !== 'in' ? ' · in hospital' : r.stay ? ' · respite' : ''}</div></div>
                  </div>
                </td>
                <td>{news2 ? <span className={`score ${news2.tone}`} title={news2.title}>{news2.label}</span> : <span className="tiny muted">–</span>}</td>
                <td>{cell(cells.morse)}</td>
                <td>{cell(cells.braden)}</td>
                <td>{cell(cells.mna)}</td>
                <td>{cells.abbey ? cell(cells.abbey) : <span className="tiny muted">–</span>}</td>
                <td>{wound ? <Chip tone={wound.tone === 'ok' ? 'ok' : wound.tone} title={wound.title}>{wound.label}</Chip> : <span className="tiny muted">None</span>}</td>
                <td>{alerts ? <Chip tone="critical">{alerts}</Chip> : <span className="tiny muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
