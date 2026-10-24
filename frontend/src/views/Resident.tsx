import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Banner, Chip, Choice, PinPad, Score, Sheet, Tick } from '../ui/kit'
import {
  ASSESSMENTS, ESCALATION, age, awaitingVerification, band, clock, findAdmin, fullName, isDueToday, levelTone, news2Parts, news2Risk,
  riskTone, scoreTone, until, when, type VitalsInput,
} from '../domain/clinical'
import { activeAlerts, latestAssessment, latestVitals, openTasks, riskChips, vitalsOf } from '../domain/selectors'
import type { Neuro, Resident, Snapshot, Vitals } from '../domain/types'
import { harmOf, neuroChanged, openIncidents, postFallProgress, typeLabel } from '../domain/incidents'
import { IncidentSheet, ReportIncidentSheet } from './Incidents'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'care', label: 'Care plan' },
  { id: 'assess', label: 'Assessments' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'meds', label: 'Medicines' },
  { id: 'wounds', label: 'Wounds' },
  { id: 'notes', label: 'Notes' },
]

export function ResidentView() {
  const { s, route, go } = useApp()
  const r = route.rid ? s.residents.find((x) => x.id === route.rid) : undefined
  const [tab, setTab] = useState(route.tab ?? 'overview')
  if (!r) return <div className="card empty">Resident not found. <button className="btn sm" onClick={() => go({ view: 'residents' })}>Back to residents</button></div>
  const due = openTasks(s, r.id).filter((t) => t.assessment).length
  const pendingSug = s.suggestions.filter((x) => x.rid === r.id && x.status === 'pending').length
  return (
    <div className="page">
      <ResHead r={r} onTab={setTab} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'assess' && due > 0 && <span className="count" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>{due} due</span>}
            {t.id === 'care' && pendingSug > 0 && <span className="count" style={{ background: 'var(--hi-soft)', color: 'var(--hi-ink)' }}>{pendingSug} to review</span>}
            {t.id === 'wounds' && s.wounds.some((w) => w.rid === r.id) && <span className="count">{s.wounds.filter((w) => w.rid === r.id).length}</span>}
          </button>
        ))}
      </div>
      <div className="fade-in" key={tab}>
        {tab === 'overview' && <Overview r={r} onTab={setTab} />}
        {tab === 'care' && <CareTab r={r} />}
        {tab === 'assess' && <AssessTab r={r} />}
        {tab === 'vitals' && <VitalsTab r={r} />}
        {tab === 'meds' && <MedsTab r={r} />}
        {tab === 'wounds' && <WoundsTab r={r} />}
        {tab === 'notes' && <NotesTab r={r} />}
      </div>
    </div>
  )
}

function ResHead({ r, onTab }: { r: Resident; onTab: (t: string) => void }) {
  const { s, go } = useApp()
  const [reporting, setReporting] = useState(false)
  const [incId, setIncId] = useState<string | null>(null)
  const v = latestVitals(s, r.id)
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="res-head">
        <Avatar id={r.id} name={r.name} size={76} dim={r.status !== 'in'} />
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{r.bed} · admitted {new Date(r.admitted).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          <h1 style={{ marginTop: 2 }}>{fullName(r)}</h1>
          <div className="muted" style={{ marginTop: 2 }}>Likes to be called <b className="ink2">{r.preferred}</b> · {age(r.dob, s.day)} · {r.sex === 'F' ? 'Female' : 'Male'} · {r.languages.join(', ')} · {r.religion}</div>
          <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
            {r.status !== 'in' && <Chip tone="accent" icon="bed" lg>In hospital</Chip>}
            {r.allergies.map((a) => <Chip key={a.substance} tone={a.type === 'allergy' ? 'critical' : 'caution'} icon="alert" lg>{a.substance}: {a.reaction}</Chip>)}
            {!r.allergies.length && <Chip tone="ok" lg>No known allergies</Chip>}
            {riskChips(s, r.id).map((c) => <Chip key={c.label} tone={c.tone} icon={c.icon} lg>{c.label}</Chip>)}
          </div>
        </div>
        <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
          {v && <div style={{ textAlign: 'center', marginRight: 8 }}><Score value={v.news2} tone={scoreTone(v.news2)} label={`NEWS2 ${v.news2}`} /><div className="tiny muted">NEWS2 {clock(v.t)}</div></div>}
          {r.status === 'in' && <button className="btn" onClick={() => setReporting(true)}><Icon name="flag" />Report incident</button>}
          <button className="btn" onClick={() => onTab('vitals')}><Icon name="heart" />Record obs</button>
          {r.status === 'in' && <button className="btn primary" onClick={() => go({ view: 'round', rid: r.id })}><Icon name="pill" />Give medicines</button>}
        </div>
      </div>
      {openIncidents(s, r.id).map((i) => {
        const pf = i.type === 'fall' ? postFallProgress(s, i) : null
        return (
          <button key={i.id} className="inc-strip" onClick={() => setIncId(i.id)}>
            <Icon name="flag" size={18} />
            <span className="grow"><b>{typeLabel(i.type)} {when(i.t, s.day).replace(/^Yesterday/, 'yesterday')}</b> · {harmOf(i.harm).label.toLowerCase()}{pf && pf.next ? ` · next post-fall check ${clock(pf.next.due)}` : ''}{!i.told.family ? ' · family not yet told' : ''}</span>
            <span className="small">Open</span>
          </button>
        )
      })}
      {reporting && <ReportIncidentSheet rid={r.id} onClose={() => setReporting(false)} onReported={(id) => { setReporting(false); setIncId(id) }} />}
      {incId && <IncidentSheet id={incId} onClose={() => setIncId(null)} />}
      {r.stay && (() => {
        const from = new Date(r.stay.from).getTime(), to = new Date(r.stay.to).getTime(), today = new Date(s.day).getTime()
        const total = Math.round((to - from) / 864e5) + 1, day = Math.round((today - from) / 864e5) + 1
        return (
          <div className="row wrap" style={{ gap: 14, padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'var(--accent-soft)' }}>
            <Chip tone="accent" icon="clock" lg>Respite stay</Chip>
            <div className="grow small" style={{ minWidth: 220 }}><b>Day {day} of {total}</b> · {new Date(r.stay.from).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} to {new Date(r.stay.to).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}. {r.stay.note}</div>
            <div className="progress" style={{ width: 160 }}><i style={{ width: `${(day / total) * 100}%`, background: 'var(--accent)' }} /></div>
          </div>
        )
      })()}
      <div className="res-facts">
        <div><span className="eyebrow">Resuscitation</span><b style={{ color: r.acp.resus.startsWith('Do not') ? 'var(--hi-ink)' : undefined }}>{r.acp.resus}</b>{r.acp.note && <span className="tiny muted">{r.acp.note}</span>}</div>
        <div><span className="eyebrow">Decision maker</span><b>{r.decisionMaker.name}</b><span className="tiny muted">{r.decisionMaker.relation} · {r.decisionMaker.type} · <span className="num">{r.decisionMaker.phone}</span></span></div>
        <div><span className="eyebrow">Diet and swallow</span><b>{r.diet}</b><span className="tiny muted">{r.swallow}</span></div>
        <div><span className="eyebrow">Mobility</span><b>{r.mobility}</b><span className="tiny muted">{r.continence}</span></div>
      </div>
    </section>
  )
}

function Overview({ r, onTab }: { r: Resident; onTab: (t: string) => void }) {
  const { s, staff, act } = useApp()
  const v = latestVitals(s, r.id)
  const alerts = activeAlerts(s, r.id)
  const tasks = openTasks(s, r.id).filter((t) => t.due < s.now + 8 * 60)
  const notes = s.notes.filter((n) => n.rid === r.id).sort((a, b) => b.t - a.t).slice(0, 3)
  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 18 }}>
        {alerts.map((a) => (
          <Banner key={a.id} tone={a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'info'} title={a.title}>
            {a.detail}{a.dueT ? ` ${a.dueLabel ?? 'Due'} ${clock(a.dueT)} (${until(a.dueT, s.now)}).` : ''}
          </Banner>
        ))}
        <section className="card">
          <div className="card-h"><h3>Latest observations</h3><span className="spacer" />{v && <span className="small muted">{when(v.t, s.day)} by {staff(v.by)?.short}</span>}</div>
          <div className="card-b">{v ? <VitalTiles v={v} /> : <div className="empty">No observations yet.</div>}</div>
          <div className="card-b" style={{ paddingTop: 0 }}><News2Chart data={vitalsOf(s, r.id)} day={s.day} /></div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Care today</h3><span className="spacer" /><button className="btn ghost sm" onClick={() => onTab('care')}>Care plan<Icon name="right" /></button></div>
          <div className="list" style={{ marginTop: 8 }}>
            {tasks.length === 0 && <div className="empty">No care tasks due.</div>}
            {tasks.map((t) => (
              <div className="task-row" key={t.id}>
                <Tick on={false} label={`Mark done: ${t.text}`} onClick={() => act('task.complete', { id: t.id }, { success: 'Done.' })} />
                <div className="grow"><b style={{ fontWeight: 600 }}>{t.text}</b>{t.repeat && <span className="tiny muted"> · {t.repeat}</span>}</div>
                <span className="small num" style={{ color: t.due < s.now ? 'var(--crit)' : 'var(--muted)', fontWeight: 650 }}>{clock(t.due)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="stack" style={{ gap: 18 }}>
        <section className="card">
          <div className="card-h"><h3>Conditions</h3></div>
          <div className="card-b"><ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{r.diagnoses.map((d) => <li key={d}>{d}</li>)}</ul></div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Risk scores</h3><span className="spacer" /><button className="btn ghost sm" onClick={() => onTab('assess')}>All<Icon name="right" /></button></div>
          <div className="list" style={{ marginTop: 6 }}>
            {Object.keys(ASSESSMENTS).map((type) => {
              const a = latestAssessment(s, r.id, type)
              const b = a ? band(type, a.score) : null
              return (
                <div className="task-row" key={type}>
                  <div className="grow"><b style={{ fontWeight: 600 }}>{ASSESSMENTS[type].short}</b><div className="tiny muted">{ASSESSMENTS[type].name}{a ? ` · ${when(a.t, s.day)}` : ''}</div></div>
                  {a && b ? <><span className="strong num">{a.score}</span><Chip tone={levelTone(b.level)}>{b.label}</Chip></> : <Chip tone="warning">Not done</Chip>}
                </div>
              )
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Recent notes</h3><span className="spacer" /><button className="btn ghost sm" onClick={() => onTab('notes')}>All notes<Icon name="right" /></button></div>
          <div className="list" style={{ marginTop: 6 }}>
            {notes.map((n) => (
              <div className="note" key={n.id}>
                <div className="row small"><b>{staff(n.by)?.name}</b><span className="muted">{n.kind} · {when(n.t, s.day)}</span></div>
                <p>{n.text}</p>
              </div>
            ))}
            {!notes.length && <div className="empty">No notes yet.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}

function VitalTiles({ v }: { v: Vitals }) {
  const parts = news2Parts(v)
  const pts = (k: string) => parts.find((p) => p.key === k)!.score
  const tiles = [
    { k: 'temp', label: 'Temperature', val: v.temp.toFixed(1), unit: '°C' },
    { k: 'pulse', label: 'Pulse', val: v.pulse, unit: '/min' },
    { k: 'rr', label: 'Breathing', val: v.rr, unit: '/min' },
    { k: 'spo2', label: 'SpO₂', val: v.spo2, unit: v.o2 ? '% on O₂' : '% air' },
    { k: 'sbp', label: 'Blood pressure', val: `${v.sbp}/${v.dbp}`, unit: 'mmHg' },
    { k: 'acvpu', label: 'Consciousness', val: v.acvpu === 'A' ? 'Alert' : v.acvpu, unit: '' },
  ]
  const risk = news2Risk(v)
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}>
        <Score value={v.news2} tone={scoreTone(v.news2)} />
        <div className="grow"><b>NEWS2 {v.news2} · {ESCALATION[risk].label} risk</b><div className="small muted">{ESCALATION[risk].action}</div></div>
      </div>
      <div className="three-col">
        {tiles.map((t) => (
          <div key={t.k} className="vital-tile" style={{ borderRadius: 14, background: pts(t.k) >= 3 ? 'var(--crit-soft)' : pts(t.k) >= 1 ? 'var(--warn-soft)' : 'var(--surface-2)' }}>
            <span className="eyebrow">{t.label}</span>
            <span className="v">{t.val}<small>{t.unit}</small></span>
            <span className="pts" style={{ color: pts(t.k) >= 3 ? 'var(--crit-ink)' : pts(t.k) >= 1 ? 'var(--warn-ink)' : 'var(--ok-ink)' }}>{pts(t.k) ? `+${pts(t.k)} NEWS2` : 'In range'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** NEWS2 over time: bands shaded, each point coloured by its score. */
export function News2Chart({ data, day }: { data: Vitals[]; day: string }) {
  if (data.length < 2) return null
  const W = 640, H = 170, L = 34, R = 12, T = 12, B = 28
  const t0 = data[0].t, t1 = data[data.length - 1].t
  const x = (t: number) => L + ((t - t0) / Math.max(t1 - t0, 1)) * (W - L - R)
  const max = Math.max(8, ...data.map((d) => d.news2))
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const col = (n: number) => `var(--${n >= 7 ? 'crit' : n >= 5 ? 'warn' : n >= 1 ? 'caution' : 'ok'})`
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.news2).toFixed(1)}`).join(' ')
  const area = `${path} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`NEWS2 trend from ${data[0].news2} to ${data[data.length - 1].news2}`}>
        <rect x={L} y={y(max)} width={W - L - R} height={y(7) - y(max)} fill="var(--crit-soft)" />
        <rect x={L} y={y(6.5)} width={W - L - R} height={y(4.5) - y(6.5)} fill="var(--warn-soft)" />
        {[0, 3, 5, 7].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray={g ? '3 4' : undefined} />
            <text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{g}</text>
          </g>
        ))}
        <path d={area} fill="var(--accent)" opacity="0.08" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={d.id}>
            <circle cx={x(d.t)} cy={y(d.news2)} r={i === data.length - 1 ? 6 : 4} fill={col(d.news2)} stroke="var(--surface)" strokeWidth="2" />
            {(i === 0 || i === data.length - 1 || data.length <= 5) && (
              <text x={x(d.t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--muted)">{when(d.t, day)}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// ---------- Vitals ----------

function VitalsTab({ r }: { r: Resident }) {
  const { s, act, staff, me } = useApp()
  const empty = { temp: '', pulse: '', rr: '', spo2: '', sbp: '', dbp: '', acvpu: 'A', o2: false, note: '' }
  const [f, setF] = useState(empty)
  const [sbarFor, setSbarFor] = useState<Vitals | null>(null)
  const neuroTask = openTasks(s, r.id).find((t) => t.text.includes('neuro obs'))
  const [withNeuro, setWithNeuro] = useState(!!neuroTask)
  const [neuro, setNeuro] = useState<Neuro>({ gcs: 15, pupils: 'equal and reactive', limbs: 'normal' })
  const filled = ['temp', 'pulse', 'rr', 'spo2', 'sbp', 'dbp'].every((k) => (f as any)[k] !== '')
  const input: VitalsInput | null = filled ? { temp: +f.temp, pulse: +f.pulse, rr: +f.rr, spo2: +f.spo2, sbp: +f.sbp, acvpu: f.acvpu as any, o2: f.o2 } : null
  const live = input ? news2Parts(input) : null
  const liveScore = live?.reduce((a, p) => a + p.score, 0)
  const risk = input ? news2Risk(input) : null
  const history = vitalsOf(s, r.id).slice().reverse()
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, '') }))
  const pt = (k: string) => live?.find((p) => p.key === k)?.score ?? 0
  const field = (k: string, label: string, unit: string, ph: string) => (
    <div className="field">
      <label htmlFor={`v-${k}`}>{label}</label>
      <div className="unit-wrap">
        <input id={`v-${k}`} className="input big" inputMode="decimal" value={(f as any)[k]} onChange={set(k)} placeholder={ph}
          style={pt(k) >= 3 ? { borderColor: 'var(--crit)' } : pt(k) >= 1 ? { borderColor: 'var(--warn)' } : undefined} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  )
  const submit = async () => {
    const res = await act<{ score: number; risk: string; alertId?: string }>('vitals.record', { rid: r.id, ...f, neuro: withNeuro ? neuro : undefined }, { success: withNeuro ? 'Observations and neuro check saved.' : 'Observations saved.' })
    if (res.ok) {
      setF(empty)
      if (res.data && (res.data.risk === 'medium' || res.data.risk === 'high')) {
        const v = latestVitals({ ...s, vitals: s.vitals } as Snapshot, r.id)
        setSbarFor({ ...(v ?? ({} as Vitals)), ...input!, dbp: +f.dbp, news2: res.data.score, t: s.now, id: 'new', rid: r.id, by: me!.id })
      }
    }
  }
  return (
    <div className="two-col">
      <section className="card">
        <div className="card-h"><h3>Record observations</h3><span className="spacer" /><button className="btn ghost sm" onClick={() => setF({ temp: '38.1', pulse: '104', rr: '22', spo2: '94', sbp: '108', dbp: '68', acvpu: 'A', o2: false, note: '' })}>Fill example</button></div>
        <div className="card-b stack" style={{ gap: 14 }}>
          <div className="three-col">
            {field('temp', 'Temperature', '°C', '36.8')}
            {field('pulse', 'Pulse', '/min', '78')}
            {field('rr', 'Breathing rate', '/min', '16')}
            {field('spo2', 'SpO₂', '%', '97')}
            {field('sbp', 'Systolic BP', 'mmHg', '128')}
            {field('dbp', 'Diastolic BP', 'mmHg', '76')}
          </div>
          <div className="field">
            <span className="label">Consciousness (ACVPU)</span>
            <Choice label="Consciousness" value={f.acvpu} onChange={(v) => setF((x) => ({ ...x, acvpu: v }))}
              options={[{ value: 'A', label: 'Alert' }, { value: 'C', label: 'New confusion' }, { value: 'V', label: 'Voice' }, { value: 'P', label: 'Pain' }, { value: 'U', label: 'Unresponsive' }]} />
          </div>
          <div className="field">
            <span className="label">Breathing</span>
            <Choice label="Air or oxygen" value={f.o2 ? 'o2' : 'air'} onChange={(v) => setF((x) => ({ ...x, o2: v === 'o2' }))} options={[{ value: 'air', label: 'Room air' }, { value: 'o2', label: 'On oxygen' }]} />
          </div>
          {neuroTask && <Banner tone="warning" icon="walk" title={`${neuroTask.text}, due ${clock(neuroTask.due)}`}>After a fall: record the neuro check with these observations.</Banner>}
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={withNeuro} onChange={(e) => setWithNeuro(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span className="small"><b>Add a neuro check</b> (Glasgow Coma Scale, pupils, limbs)</span>
          </label>
          {withNeuro && (
            <div className="neuro-box stack" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="v-gcs">Glasgow Coma Scale</label>
                <div className="row" style={{ gap: 10 }}>
                  <button className="btn" aria-label="Lower GCS" onClick={() => setNeuro((n) => ({ ...n, gcs: Math.max(3, n.gcs - 1) }))}>−</button>
                  <input id="v-gcs" className="input big" style={{ width: 90, textAlign: 'center' }} inputMode="numeric" value={neuro.gcs}
                    onChange={(e) => setNeuro((n) => ({ ...n, gcs: Math.min(15, Math.max(3, Number(e.target.value.replace(/\D/g, '')) || 3)) }))} />
                  <button className="btn" aria-label="Raise GCS" onClick={() => setNeuro((n) => ({ ...n, gcs: Math.min(15, n.gcs + 1) }))}>+</button>
                  <span className="small muted">out of 15</span>
                </div>
              </div>
              <div className="field">
                <span className="label">Pupils</span>
                <Choice label="Pupils" value={neuro.pupils} onChange={(v) => setNeuro((n) => ({ ...n, pupils: v }))} options={[{ value: 'equal and reactive', label: 'Equal and reactive' }, { value: 'unequal or sluggish', label: 'Unequal or sluggish' }]} />
              </div>
              <div className="field">
                <span className="label">Arms and legs</span>
                <Choice label="Limbs" value={neuro.limbs} onChange={(v) => setNeuro((n) => ({ ...n, limbs: v }))} options={[{ value: 'normal', label: 'Moving normally' }, { value: 'new weakness', label: 'New weakness' }]} />
              </div>
              {neuroChanged(neuro, vitalsOf(s, r.id).find((x) => x.neuro)?.neuro) && <Banner tone="critical" title="Neuro signs have changed">Call the doctor now. Consider an ambulance (995) if GCS keeps falling. Saving raises an alert to the nurse in charge.</Banner>}
            </div>
          )}
          <div className="field">
            <label htmlFor="v-note">Note (optional)</label>
            <input id="v-note" className="input" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} placeholder="For example: productive cough" />
          </div>
          {risk && liveScore !== undefined && (
            <div className={`banner ${riskTone(risk) === 'critical' ? 'critical' : riskTone(risk) === 'warning' ? 'warning' : riskTone(risk) === 'caution' ? 'warning' : 'ok'}`}>
              <Score value={liveScore} tone={scoreTone(liveScore)} />
              <div className="grow"><b>NEWS2 {liveScore} · {ESCALATION[risk].label} risk</b><div className="small">{ESCALATION[risk].action}</div></div>
            </div>
          )}
          {r.acp.resus.startsWith('Do not') && risk && risk !== 'low' && <Banner tone="hi" icon="info" title={`Advance care plan: ${r.acp.resus}`}>{r.acp.note || 'Check the advance care plan before any transfer.'}</Banner>}
          <button className="btn primary lg" disabled={!filled} onClick={submit}>Save observations</button>
          <p className="tiny muted">NEWS2 uses SpO₂ scale 1. The response to each score is set by the home's escalation policy.</p>
        </div>
      </section>
      <div className="stack" style={{ gap: 18 }}>
        <section className="card">
          <div className="card-h"><h3>NEWS2 trend</h3></div>
          <div className="card-b"><News2Chart data={vitalsOf(s, r.id)} day={s.day} /></div>
        </section>
        <section className="card">
          <div className="card-h"><h3>History</h3></div>
          <div className="mar-wrap" style={{ marginTop: 8 }}>
            <table className="mar" style={{ minWidth: 520 }}>
              <thead><tr><th>When</th><th>NEWS2</th><th>T</th><th>P</th><th>RR</th><th>SpO₂</th><th>BP</th><th>GCS</th><th>By</th></tr></thead>
              <tbody className="num">
                {history.map((v) => (
                  <tr key={v.id}>
                    <td>{when(v.t, s.day)}</td>
                    <td><Score value={v.news2} tone={scoreTone(v.news2)} /></td>
                    <td>{v.temp.toFixed(1)}</td><td>{v.pulse}</td><td>{v.rr}</td><td>{v.spo2}</td><td>{v.sbp}/{v.dbp}</td>
                    <td title={v.neuro ? `Pupils ${v.neuro.pupils}, limbs ${v.neuro.limbs}` : undefined} style={v.neuro && v.neuro.gcs < 15 ? { color: 'var(--crit)', fontWeight: 700 } : undefined}>{v.neuro?.gcs ?? '–'}</td>
                    <td className="small">{staff(v.by)?.short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {sbarFor && <SbarSheet r={r} v={sbarFor} onClose={() => setSbarFor(null)} />}
    </div>
  )
}

function sbarDraft(s: Snapshot, r: Resident, v: Vitals, nurse: string) {
  const prev = vitalsOf(s, r.id).filter((x) => x.t < v.t - 5).slice(-1)[0]
  const meds = s.orders.filter((o) => o.rid === r.id && !o.prn).map((o) => o.drug.split(' (')[0]).join(', ')
  const allergies = r.allergies.length ? r.allergies.map((a) => `${a.substance}, ${a.reaction.toLowerCase()}`).join('; ') : 'none known'
  const parts = news2Parts(v).filter((p) => p.score > 0).map((p) => p.label)
  return [
    `S: ${fullName(r)}, ${age(r.dob, s.day)}, bed ${r.bed}. NEWS2 ${v.news2} at ${clock(v.t)}${prev ? `, up from ${prev.news2} at ${clock(prev.t)}` : ''}. Temp ${v.temp} °C, pulse ${v.pulse}, RR ${v.rr}, SpO₂ ${v.spo2}% ${v.o2 ? 'on oxygen' : 'on air'}, BP ${v.sbp}/${v.dbp}, ${v.acvpu === 'A' ? 'alert' : `ACVPU ${v.acvpu}`}.`,
    `B: ${r.diagnoses.join('; ')}. Allergies: ${allergies}. Regular medicines: ${meds || 'none'}.`,
    `A: Scores raised on ${parts.join(', ')}. [Nurse to add own assessment: chest, hydration, pain, behaviour.]`,
    `R: Please review within 30 minutes. Observations every hour per home policy. Advance care plan: ${r.acp.resus}.${r.acp.note ? ` ${r.acp.note.replace(/\.$/, '')}.` : ''} Decision maker: ${r.decisionMaker.name} (${r.decisionMaker.relation}, ${r.decisionMaker.type}).`,
    ``,
    `${nurse}, ${s.ward.name}`,
  ].join('\n')
}

function SbarSheet({ r, v, onClose }: { r: Resident; v: Vitals; onClose: () => void }) {
  const { s, me, act } = useApp()
  const doctor = s.staff.find((x) => x.role === 'DR')!
  const [text, setText] = useState(() => sbarDraft(s, r, v, me!.name))
  const [reviewed, setReviewed] = useState(false)
  return (
    <Sheet wide title="Tell the doctor" sub={`SBAR for ${doctor.name}`} icon="send" tone="warning" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Not now</button><button className="btn primary" disabled={!reviewed} onClick={async () => {
        const res = await act('sbar.send', { rid: r.id, to: doctor.id, text, reviewed }, { success: `Sent to ${doctor.name}.` })
        if (res.ok) onClose()
      }}><Icon name="send" />Send to {doctor.short}</button></>}>
      <div className="row"><span className="ai-tag"><Icon name="sparkle" />Draft by the assistant</span><span className="small muted">Built from the record. Check it, add your own assessment, then send.</span></div>
      <label htmlFor="sbar-text" className="sr">SBAR message</label>
      <textarea id="sbar-text" className="textarea" style={{ minHeight: 260, fontSize: 15 }} value={text} onChange={(e) => setText(e.target.value)} />
      <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} style={{ width: 22, height: 22 }} />
        <span>I have checked this message and it is accurate. It will be signed by me.</span>
      </label>
    </Sheet>
  )
}

// ---------- Care plan ----------

function CareTab({ r }: { r: Resident }) {
  const { s, act, staff, me } = useApp()
  const plan = s.carePlans.find((c) => c.rid === r.id)
  const sugs = s.suggestions.filter((x) => x.rid === r.id && x.status === 'pending')
  const tasks = s.tasks.filter((t) => t.rid === r.id && !t.assessment && t.due < s.now + 16 * 60).sort((a, b) => a.due - b.due)
  return (
    <div className="two-col">
      <div className="stack" style={{ gap: 18 }}>
        {sugs.map((sg) => <SuggestionCard key={sg.id} id={sg.id} />)}
        <section className="card">
          <div className="card-h">
            <h3>Care plan</h3>
            <span className="spacer" />
            {plan?.signedBy ? <span className="small muted">Signed by {staff(plan.signedBy)?.name} · {plan.signedT !== null ? when(plan.signedT, s.day) : ''} · review by {plan.reviewDue}</span> : <Chip tone="warning">Not yet signed</Chip>}
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {!plan?.problems.length && <div className="empty">No care plan yet. It is built from the admission assessments.</div>}
            {plan?.problems.map((p) => (
              <div className="problem" key={p.id}>
                <div className="row wrap"><h4 className="grow">{p.title}</h4><span className="tiny muted">{p.basis}</span></div>
                <div className="small"><span className="muted">Goal: </span><b>{p.goal}</b></div>
                <ul>{p.interventions.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-h"><h3>Tasks from the plan</h3><span className="spacer" /><span className="small muted">Next 16 hours</span></div>
        <div className="list" style={{ marginTop: 8 }}>
          {tasks.map((t) => (
            <div className="task-row" key={t.id}>
              <Tick on={!!t.done} label={`Mark done: ${t.text}`} onClick={() => act('task.complete', { id: t.id }, { success: 'Done.' })} />
              <div className="grow">
                <b style={{ fontWeight: 600, textDecoration: t.done ? 'line-through' : undefined, color: t.done ? 'var(--muted)' : undefined }}>{t.text}</b>
                <div className="tiny muted">{t.done ? `Done ${clock(t.done.t)} by ${staff(t.done.by)?.short}${t.done.note ? ` · ${t.done.note}` : ''}` : t.repeat ? `Repeats ${t.repeat}` : t.category}</div>
              </div>
              {!t.done && <span className="small num" style={{ color: t.due < s.now ? 'var(--crit)' : 'var(--muted)', fontWeight: 650 }}>{clock(t.due)}</span>}
            </div>
          ))}
          {!tasks.length && <div className="empty">No tasks.</div>}
        </div>
        {me?.role === 'CA' && <div className="card-b small muted">Care aides tick off tasks here. Changes to the plan need a nurse.</div>}
      </section>
    </div>
  )
}

function SuggestionCard({ id }: { id: string }) {
  const { s, act, me, toast } = useApp()
  const sg = s.suggestions.find((x) => x.id === id)!
  const [off, setOff] = useState<Set<string>>(new Set())
  const [signing, setSigning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canSign = me?.role === 'RN' || me?.role === 'NM'
  const keep = sg.items.filter((i) => !off.has(i))
  return (
    <section className="suggest">
      <div className="row"><span className="ai-tag"><Icon name="sparkle" />Suggested from {sg.source}</span><span className="spacer" /><span className="tiny muted">{sg.basis}</span></div>
      <h3 style={{ fontSize: 17 }}>{sg.problem[0].toUpperCase() + sg.problem.slice(1)}</h3>
      <div className="stack" style={{ gap: 6 }}>
        {sg.items.map((i) => (
          <div key={i} className={`suggest-item${off.has(i) ? ' off' : ''}`}>
            <span className="grow">{i}</span>
            <button className="btn ghost sm" onClick={() => setOff((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n })}>{off.has(i) ? 'Keep' : 'Remove'}</button>
          </div>
        ))}
      </div>
      {canSign ? (
        <div className="row wrap">
          <button className="btn ghost" onClick={() => act('suggestion.dismiss', { suggestionId: sg.id }, { success: 'Suggestion dismissed.' })}>Dismiss all</button>
          <span className="spacer" />
          <button className="btn primary" disabled={!keep.length} onClick={() => setSigning(true)}>Approve {keep.length} and sign</button>
        </div>
      ) : <div className="small" style={{ color: 'var(--hi-ink)' }}>A registered nurse reviews and signs these suggestions.</div>}
      {signing && (
        <Sheet title="Sign care plan changes" sub={`${keep.length} interventions will be added and turned into tasks`} icon="shield" onClose={() => setSigning(false)}>
          <PinPad error={err} onDone={async (pin) => {
            const res = await act('careplan.approve', { suggestionId: sg.id, items: keep, pin }, { quiet: true })
            if (res.ok) { setSigning(false); toast('Care plan signed. Tasks added.') } else setErr(res.message)
          }} />
        </Sheet>
      )}
    </section>
  )
}

// ---------- Assessments ----------

function AssessTab({ r }: { r: Resident }) {
  const { s, staff } = useApp()
  const [run, setRun] = useState<string | null>(null)
  const dueTasks = openTasks(s, r.id).filter((t) => t.assessment)
  return (
    <div className="stack" style={{ gap: 18 }}>
      {dueTasks.length > 0 && <Banner tone="warning" icon="clock" title={`${dueTasks.length} assessment${dueTasks.length > 1 ? 's' : ''} due by ${when(dueTasks[0].due, s.day)}`}>Admission assessments must be done within 48 hours. The RN's care plan follows within 72 hours.</Banner>}
      <div className="bed-grid">
        {Object.entries(ASSESSMENTS).map(([type, def]) => {
          const hist = s.assessments.filter((a) => a.rid === r.id && a.type === type).sort((a, b) => b.t - a.t)
          const last = hist[0]
          const b = last ? band(type, last.score) : null
          const due = dueTasks.find((t) => t.assessment === type)
          return (
            <div key={type} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row"><span className="eyebrow grow">{def.short}</span>{due ? <Chip tone="warning">Due</Chip> : b && <Chip tone={levelTone(b.level)}>{b.label}</Chip>}</div>
              <h3 style={{ fontSize: 16 }}>{def.name}</h3>
              {last ? (
                <div className="row"><span style={{ fontSize: 30, fontWeight: 750 }} className="num">{last.score}</span><span className="small muted grow">{when(last.t, s.day)} by {staff(last.by)?.short}{last.signedBy ? `, signed by ${staff(last.signedBy)?.short}` : ''}</span></div>
              ) : <div className="muted small">Not done yet.</div>}
              {hist.length > 1 && <div className="tiny muted">Before: {hist.slice(1, 4).map((h) => `${h.score} (${when(h.t, s.day)})`).join(' · ')}</div>}
              <button className={`btn ${due ? 'primary' : ''}`} onClick={() => setRun(type)}>{last ? 'Reassess' : 'Start'} · about {def.minutes} min</button>
            </div>
          )
        })}
      </div>
      {run && <AssessmentRunner type={run} r={r} onClose={() => setRun(null)} />}
    </div>
  )
}

function AssessmentRunner({ type, r, onClose }: { type: string; r: Resident; onClose: () => void }) {
  const { act, toast } = useApp()
  const def = ASSESSMENTS[type]
  const [ans, setAns] = useState<Record<string, number>>({})
  const [signing, setSigning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const complete = def.items.every((i) => ans[i.id] !== undefined)
  const score = def.items.reduce((sum, i) => sum + (ans[i.id] !== undefined ? i.options[ans[i.id]].score : 0), 0)
  const b = band(type, score)
  return (
    <Sheet wide title={def.name} sub={`${fullName(r)} · ${def.items.length} questions`} icon="note" onClose={onClose}
      footer={!signing ? <>
        <div className="row grow" style={{ gap: 10 }}><span style={{ fontSize: 26, fontWeight: 750 }} className="num">{score}</span><Chip tone={complete ? levelTone(b.level) : undefined} lg>{complete ? b.label : `${Object.keys(ans).length} of ${def.items.length} answered`}</Chip></div>
        <button className="btn primary" style={{ flex: 'none' }} disabled={!complete} onClick={() => setSigning(true)}>Sign</button>
      </> : undefined}>
      {!signing ? def.items.map((it, n) => (
        <div className="field" key={it.id}>
          <span className="label">{n + 1}. {it.label}</span>
          <Choice label={it.label} value={ans[it.id]} onChange={(v) => setAns((a) => ({ ...a, [it.id]: v }))} options={it.options.map((o, i) => ({ value: i, label: o.label, pts: o.score }))} />
        </div>
      )) : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <div className="row"><span style={{ fontSize: 30, fontWeight: 750 }}>{score}</span><Chip tone={levelTone(b.level)} lg>{b.label}</Chip></div>
          {def.suggest[b.level] && <p className="small muted" style={{ textAlign: 'center', maxWidth: 420 }}>After you sign, care plan suggestions for {def.short.toLowerCase()} will be ready for an RN to review.</p>}
          <PinPad error={err} onDone={async (pin) => {
            const res = await act('assessment.submit', { rid: r.id, type, answers: ans, pin }, { quiet: true })
            if (res.ok) { toast(`${def.short} assessment signed: ${score}, ${b.label.toLowerCase()}.`); onClose() } else setErr(res.message)
          }} />
        </div>
      )}
    </Sheet>
  )
}

// ---------- Medicines (MAR) ----------

function MedsTab({ r }: { r: Resident }) {
  const { s, staff, go } = useApp()
  const orders = s.orders.filter((o) => o.rid === r.id)
  const regular = orders.filter((o) => !o.prn)
  const prn = orders.filter((o) => o.prn)
  const slots = [...new Set(regular.flatMap((o) => o.slots))].sort()
  const verifying = orders.filter(awaitingVerification)
  const pill = (o: (typeof orders)[number], sl: string) => {
    if (o.stopped) {
      if (!o.slots.includes(sl)) return <span className="muted">·</span>
      const d = findAdmin(s, o.id, sl)
      return d ? <span className="mar-pill tone-warning" title={`Popped out of the blister pack by ${staff(d.by)?.name}`}>Discarded</span> : <span className="mar-pill" style={{ background: 'var(--sunken)' }}>Stopped</span>
    }
    if (!o.slots.includes(sl) || !isDueToday(o, s.day)) return <span className="muted">·</span>
    const a = findAdmin(s, o.id, sl)
    if (!a) {
      const late = s.now > parseInt(sl) * 60 + 60
      return <span className={`mar-pill ${r.status !== 'in' ? '' : late ? 'tone-critical' : 'tone-accent'}`} style={{ background: r.status !== 'in' ? 'var(--sunken)' : undefined }}>{r.status !== 'in' ? 'Suspended' : late ? 'Overdue' : 'Due'}</span>
    }
    return <span className={`mar-pill tone-${a.outcome === 'given' ? 'ok' : 'warning'}`} title={`${a.outcome} by ${staff(a.by)?.name}${a.reason ? `: ${a.reason}` : ''}`}>{a.outcome === 'given' ? `✓ ${clock(a.t)}` : a.outcome[0].toUpperCase() + a.outcome.slice(1)}</span>
  }
  return (
    <div className="stack" style={{ gap: 18 }}>
      {verifying.length > 0 && <Banner tone="warning" icon="shield" title="Admission medicines waiting for RN verification">{verifying.map((o) => o.drug).join(', ')}. Open the medication round to verify.</Banner>}
      <section className="card">
        <div className="card-h"><h3>Today's chart</h3><span className="spacer" />{r.status === 'in' && <button className="btn sm primary" onClick={() => go({ view: 'round', rid: r.id })}><Icon name="pill" />Open round</button>}</div>
        <div className="mar-wrap" style={{ marginTop: 10 }}>
          <table className="mar">
            <thead><tr><th>Medicine</th>{slots.map((sl) => <th key={sl} style={{ textAlign: 'center' }}>{sl}</th>)}</tr></thead>
            <tbody>
              {regular.map((o) => (
                <tr key={o.id}>
                  <td style={{ minWidth: 220 }}>
                    <b>{o.stopped ? <s>{o.drug}</s> : o.drug}</b>
                    <div className="small muted">{o.dose} · {o.route}{o.weekly !== undefined ? ' · weekly' : ''}{o.ownSupply ? ' · own supply from home' : ''}</div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                      {o.highAlert && <Chip tone="hi">High-alert</Chip>}{o.cd && <Chip tone="hi">CD</Chip>}{o.timeCritical && <Chip tone="warning">Time-critical</Chip>}
                      {o.stopped && <Chip tone="critical" title={o.stopped.reason}>Stopped {when(o.stopped.t, s.day)}</Chip>}
                      {o.review && <Chip tone="accent">Review {new Date(o.review).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</Chip>}
                    </div>
                  </td>
                  {slots.map((sl) => <td key={sl} className="cell">{pill(o, sl)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {prn.length > 0 && (
        <section className="card">
          <div className="card-h"><h3>As needed (PRN)</h3></div>
          <div className="list" style={{ marginTop: 8 }}>
            {prn.map((o) => {
              const doses = s.prn.filter((p) => p.orderId === o.id).sort((a, b) => b.t - a.t)
              return (
                <div className="note" key={o.id}>
                  <b>{o.drug} · {o.dose}</b>
                  <span className="small muted">{o.prn!.reason} · max {o.prn!.maxPer24h} in 24 h</span>
                  {doses.slice(0, 3).map((d) => <span key={d.id} className="small">{when(d.t, s.day)}: {d.reason}{d.pain !== undefined ? `, pain ${d.pain}/10` : ''} · {staff(d.by)?.short}{d.effect ? ` · ${d.effect.result}` : ' · effect pending'}</span>)}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------- Wounds ----------

function WoundsTab({ r }: { r: Resident }) {
  const { s, staff } = useApp()
  const wounds = s.wounds.filter((w) => w.rid === r.id)
  const [measure, setMeasure] = useState<string | null>(null)
  if (!wounds.length) return <div className="card empty">No wounds recorded. Skin is checked every day as part of care.</div>
  return (
    <div className="stack" style={{ gap: 18 }}>
      {wounds.map((w) => {
        const ms = w.measurements
        const last = ms[ms.length - 1]
        const first = ms[0]
        const area = (m: typeof last) => +(m.length * m.width).toFixed(2)
        const change = ms.length > 1 ? Math.round((1 - area(last) / area(first)) * 100) : null
        return (
          <section className="card" key={w.id}>
            <div className="card-h">
              <span className="med-icon tone-warning"><Icon name="wound" /></span>
              <div className="grow"><h3>{w.site}</h3><span className="small muted">{w.type} · found {new Date(w.found).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}</span></div>
              <button className="btn primary" onClick={() => setMeasure(w.id)}><Icon name="camera" />Measure and dress</button>
            </div>
            <div className="card-b two-col" style={{ gap: 18 }}>
              <div className="stack" style={{ gap: 10 }}>
                <div className="row wrap" style={{ gap: 24 }}>
                  <div><div className="eyebrow">Latest size</div><div style={{ fontSize: 24, fontWeight: 750 }} className="num">{last.length} × {last.width} cm</div><div className="tiny muted">{when(last.t, s.day)} · {staff(last.by)?.short}</div></div>
                  {change !== null && <div><div className="eyebrow">Since first</div><div style={{ fontSize: 24, fontWeight: 750, color: change > 0 ? 'var(--ok-ink)' : 'var(--crit-ink)' }}>{change > 0 ? `${change}% smaller` : `${-change}% larger`}</div></div>}
                </div>
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Wound bed</dt><dd>{last.bed}</dd>
                  <dt>Exudate</dt><dd>{last.exudate}</dd>
                  <dt>Dressing</dt><dd>{w.dressing}</dd>
                  <dt>Next change</dt><dd style={{ color: w.nextDressing < s.now + 240 ? 'var(--warn-ink)' : undefined, fontWeight: 650 }}>{when(w.nextDressing, s.day)} ({until(w.nextDressing, s.now)})</dd>
                </dl>
              </div>
              <WoundChart ms={ms} day={s.day} />
            </div>
            {last.photo && <div className="card-b"><img src={last.photo} alt={`${w.site} wound, latest photo`} style={{ maxHeight: 220, borderRadius: 12 }} /></div>}
          </section>
        )
      })}
      {measure && <MeasureSheet woundId={measure} onClose={() => setMeasure(null)} />}
    </div>
  )
}

function WoundChart({ ms, day }: { ms: { t: number; length: number; width: number }[]; day: string }) {
  const W = 360, H = 150, L = 40, R = 12, T = 14, B = 26
  const areas = ms.map((m) => m.length * m.width)
  const max = Math.max(...areas) * 1.15
  const x = (i: number) => L + (ms.length === 1 ? (W - L - R) / 2 : (i / (ms.length - 1)) * (W - L - R))
  const y = (a: number) => T + (1 - a / max) * (H - T - B)
  return (
    <div className="chart-box">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Area (cm²)</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Wound area over time">
        {[0, max / 2].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" /><text x={L - 6} y={y(g) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{g.toFixed(1)}</text></g>)}
        {ms.map((m, i) => (
          <g key={i}>
            <rect x={x(i) - 14} y={y(areas[i])} width="28" height={y(0) - y(areas[i])} rx="6" fill={i === ms.length - 1 ? 'var(--accent)' : 'var(--accent-soft)'} />
            <text x={x(i)} y={y(areas[i]) - 5} fontSize="11" textAnchor="middle" fill="var(--ink-2)" fontWeight="700">{areas[i].toFixed(1)}</text>
            <text x={x(i)} y={H - 8} fontSize="10.5" textAnchor="middle" fill="var(--muted)">{when(m.t, day).replace('Yesterday', 'Yest.')}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function MeasureSheet({ woundId, onClose }: { woundId: string; onClose: () => void }) {
  const { s, act } = useApp()
  const w = s.wounds.find((x) => x.id === woundId)!
  const last = w.measurements[w.measurements.length - 1]
  const [f, setF] = useState({ length: '', width: '', depth: '', bed: last.bed, exudate: last.exudate, dressed: true })
  const [photo, setPhoto] = useState<string | null>(null)
  const onFile = (file?: File) => {
    if (!file) return
    const img = new Image()
    const reader = new FileReader()
    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, 640 / img.width)
        const c = document.createElement('canvas')
        c.width = img.width * scale; c.height = img.height * scale
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        setPhoto(c.toDataURL('image/jpeg', 0.75))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }
  return (
    <Sheet title={`Measure: ${w.site}`} sub={w.type} icon="wound" tone="warning" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.length || !f.width} onClick={async () => {
        const res = await act('wound.measure', { woundId, ...f, length: +f.length, width: +f.width, depth: +f.depth || 0, photo }, { success: 'Wound recorded.' })
        if (res.ok) onClose()
      }}>Save</button></>}>
      <div className="three-col">
        {(['length', 'width', 'depth'] as const).map((k) => (
          <div className="field" key={k}>
            <label htmlFor={`w-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
            <div className="unit-wrap"><input id={`w-${k}`} className="input big" inputMode="decimal" placeholder={String(last[k])} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, '') }))} /><span className="unit">cm</span></div>
          </div>
        ))}
      </div>
      <div className="field"><label htmlFor="w-bed">Wound bed</label><input id="w-bed" className="input" value={f.bed} onChange={(e) => setF((x) => ({ ...x, bed: e.target.value }))} /></div>
      <div className="field"><span className="label">Exudate</span><Choice label="Exudate" value={f.exudate} onChange={(v) => setF((x) => ({ ...x, exudate: v }))} options={['None', 'Low', 'Moderate', 'Heavy'].map((v) => ({ value: v, label: v }))} /></div>
      <div className="field">
        <span className="label">Photo (optional)</span>
        <label className="pack-opt" style={{ cursor: 'pointer' }}>
          <Icon name="camera" size={22} /><span className="grow">{photo ? 'Photo added. Tap to replace.' : 'Add a photo from the tablet camera or gallery'}</span>
          <input type="file" accept="image/*" capture="environment" className="sr" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {photo && <img src={photo} alt="Wound preview" style={{ maxHeight: 160, borderRadius: 12, alignSelf: 'flex-start' }} />}
      </div>
      <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.dressed} onChange={(e) => setF((x) => ({ ...x, dressed: e.target.checked }))} style={{ width: 22, height: 22 }} />
        <span>Dressing changed now ({w.dressing.toLowerCase()})</span>
      </label>
    </Sheet>
  )
}

// ---------- Notes ----------

function NotesTab({ r }: { r: Resident }) {
  const { s, act, staff } = useApp()
  const [kind, setKind] = useState('Nursing')
  const [text, setText] = useState('')
  const notes = useMemo(() => s.notes.filter((n) => n.rid === r.id).sort((a, b) => b.t - a.t), [s.notes, r.id])
  const prompts: Record<string, string> = {
    Nursing: 'What did you see, what did you do, and how did they respond?',
    'Family contact': 'Who you spoke to, what you told them, and what they asked.',
    Behaviour: 'Antecedent, behaviour, consequence. What helped?',
    'Doctor round': 'What the doctor reviewed and the plan.',
  }
  return (
    <div className="two-col">
      <section className="card">
        <div className="list">
          {notes.map((n) => (
            <div className="note" key={n.id}>
              <div className="row small wrap"><Avatar id={n.by} name={staff(n.by)?.name ?? '?'} size={26} /><b>{staff(n.by)?.name}</b><Chip>{n.kind}</Chip><span className="muted">{when(n.t, s.day)}</span></div>
              <p>{n.text}</p>
            </div>
          ))}
          {!notes.length && <div className="empty">No notes yet.</div>}
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h3>Write a note</h3></div>
        <div className="card-b stack">
          <Choice label="Note type" value={kind} onChange={setKind} options={Object.keys(prompts).map((k) => ({ value: k, label: k }))} />
          <label htmlFor="note-text" className="sr">Note</label>
          <textarea id="note-text" className="textarea" placeholder={prompts[kind]} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" disabled={!text.trim()} onClick={async () => {
            const res = await act('note.add', { rid: r.id, kind, text }, { success: 'Note saved.' })
            if (res.ok) setText('')
          }}>Save note</button>
          <p className="tiny muted">Notes are signed with your name and time and cannot be edited afterwards. Add a new note to correct one.</p>
        </div>
      </section>
    </div>
  )
}


