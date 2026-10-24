import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Banner, Chip, Choice, Ring, Sheet } from '../ui/kit'
import { clock, fullName, residentOf, until, when } from '../domain/clinical'
import {
  FALL_FACTORS, HARM, INCIDENT_TYPES, closeBlockers, harmOf, isSerious, needsNeuro, onBloodThinner, postFallProgress, typeLabel,
} from '../domain/incidents'
import type { HarmLevel, Incident, IncidentType } from '../domain/types'

const STATUS: Record<Incident['status'], { label: string; tone: string }> = {
  open: { label: 'Waiting for review', tone: 'warning' },
  review: { label: 'Reviewed, not closed', tone: 'accent' },
  closed: { label: 'Closed', tone: 'ok' },
}

export function Incidents() {
  const { s } = useApp()
  const [show, setShow] = useState<'open' | 'closed' | 'all'>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const [report, setReport] = useState(false)
  const list = s.incidents
    .filter((i) => (show === 'all' ? true : show === 'open' ? i.status !== 'closed' : i.status === 'closed'))
    .sort((a, b) => b.t - a.t)
  const since30 = Math.floor(s.now / 1440) * 1440 - 29 * 1440
  const falls30 = s.incidents.filter((i) => i.type === 'fall' && i.t >= since30)
  const bedDays = s.residents.filter((r) => r.status === 'in').length * 30
  return (
    <div className="page">
      <div className="section-h" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="eyebrow">{s.ward.name}</div>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>Incidents</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Reporting is about learning, not blame. Report facts only.</p>
        </div>
        <button className="btn primary lg" onClick={() => setReport(true)}><Icon name="plus" />Report an incident</button>
      </div>

      <div className="mgr-figures inc-figures">
        <div><span className="eyebrow">Open</span><b className="num">{s.incidents.filter((i) => i.status !== 'closed').length}</b></div>
        <div><span className="eyebrow">Falls, 30 days</span><b className="num">{falls30.length}</b></div>
        <div><span className="eyebrow">Falls with injury</span><b className="num">{falls30.filter((i) => i.harm <= 3).length}</b></div>
        <div><span className="eyebrow">Per 1,000 bed-days</span><b className="num">{bedDays ? ((falls30.length / bedDays) * 1000).toFixed(1) : '–'}</b></div>
      </div>

      <section className="card now-list">
        <div className="card-h">
          <div className="seg" role="group" aria-label="Show">
            {(['open', 'closed', 'all'] as const).map((k) => <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{k === 'open' ? 'Open' : k === 'closed' ? 'Closed' : 'All'}</button>)}
          </div>
        </div>
        <div className="list" style={{ marginTop: 10 }}>
          {list.length === 0 && <div className="empty">{show === 'open' ? 'No open incidents.' : 'Nothing here yet.'}</div>}
          {list.map((i) => <IncidentRow key={i.id} i={i} onOpen={() => setOpenId(i.id)} />)}
        </div>
      </section>
      {report && <ReportIncidentSheet onClose={() => setReport(false)} onReported={(id) => { setReport(false); setOpenId(id) }} />}
      {openId && <IncidentSheet id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

export function IncidentRow({ i, onOpen }: { i: Incident; onOpen: () => void }) {
  const { s } = useApp()
  const r = residentOf(s, i.rid)!
  const h = harmOf(i.harm)
  const pf = i.type === 'fall' && i.status !== 'closed' ? postFallProgress(s, i) : null
  return (
    <button className="now-row as-btn" onClick={onOpen}>
      <span className={`sev-bar ${i.status === 'closed' ? 'ok' : isSerious(i) ? 'critical' : 'warning'}`} />
      <Avatar id={r.id} name={r.name} size={40} />
      <div className="why">
        <b>{typeLabel(i.type)} · {fullName(r)}</b>
        <span>{when(i.t, s.day)} · {i.where || 'Place not recorded'} · {h.label}{pf && pf.total ? ` · post-fall obs ${pf.done} of ${pf.total}` : ''}</span>
      </div>
      <Chip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Chip>
      <Icon name="right" size={18} />
    </button>
  )
}

export function ReportIncidentSheet({ rid, onClose, onReported }: { rid?: string; onClose: () => void; onReported?: (id: string) => void }) {
  const { s, act } = useApp()
  const [who, setWho] = useState(rid ?? '')
  const [type, setType] = useState<IncidentType | undefined>()
  const [ago, setAgo] = useState(0)
  const [where, setWhere] = useState('')
  const [what, setWhat] = useState('')
  const [witnessed, setWitnessed] = useState<'yes' | 'no' | undefined>()
  const [head, setHead] = useState<'yes' | 'no' | 'not sure' | undefined>()
  const [injury, setInjury] = useState('')
  const [harm, setHarm] = useState<HarmLevel | undefined>()
  const [action, setAction] = useState('')
  const [familyTold, setFamilyTold] = useState(false)
  const [doctorTold, setDoctorTold] = useState(false)
  const r = who ? residentOf(s, who) : undefined
  const thinner = r ? onBloodThinner(s, r.id) : false
  const neuro = type === 'fall' && witnessed && head ? needsNeuro({ witnessed: witnessed === 'yes', headStrike: head, bloodThinner: thinner }) : false
  const ready = r && type && what.trim() && harm && (type !== 'fall' || (witnessed && head))
  const submit = async () => {
    const res = await act<{ id: string }>('incident.report', {
      rid: who, type, t: s.now - ago, where, what, injury: injury || 'None', harm, action, familyTold, doctorTold,
      fall: type === 'fall' ? { witnessed: witnessed === 'yes', headStrike: head } : undefined,
    }, { success: 'Incident reported. Thank you.' })
    if (!res.ok) return
    if (onReported) onReported(res.data!.id)
    else onClose()
  }
  return (
    <Sheet title="Report an incident" sub="Facts only: what you saw, heard and did." icon="flag" tone="warning" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ready} onClick={submit}>Submit report</button></>}>
      {!rid && (
        <div className="field">
          <label htmlFor="inc-who">Resident involved</label>
          <select id="inc-who" className="select" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose a resident</option>
            {s.residents.filter((x) => x.status === 'in').map((x) => <option key={x.id} value={x.id}>{x.bed} · {fullName(x)}</option>)}
          </select>
        </div>
      )}
      {r && rid && <div className="row" style={{ gap: 10 }}><Avatar id={r.id} name={r.name} size={36} /><b>{fullName(r)}</b><span className="muted small">{r.bed}</span></div>}
      <div className="field">
        <span className="label">What happened</span>
        <div className="choice">{INCIDENT_TYPES.map((x) => <button key={x.value} aria-pressed={type === x.value} onClick={() => setType(x.value)}><span className="row" style={{ gap: 8 }}><Icon name={x.icon} size={18} />{x.label}</span></button>)}</div>
      </div>
      {type === 'abuse' && <Banner tone="critical" icon="shield" title="This starts the MOH 72-hour clock">The Head of Nursing or a key appointment holder must send the preliminary notification to MOH within 72 hours. Keep the resident safe first. Report facts only.</Banner>}
      <div className="two-fields">
        <div className="field">
          <span className="label">When</span>
          <Choice label="When" value={ago} onChange={setAgo} options={[{ value: 0, label: 'Just now' }, { value: 30, label: '30 min ago' }, { value: 60, label: '1 hour ago' }, { value: 180, label: '3 hours ago' }]} />
          <span className="tiny muted">{clock(s.now - ago)}</span>
        </div>
        <div className="field">
          <label htmlFor="inc-where">Where</label>
          <input id="inc-where" className="input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder={r ? `For example: bathroom, ${r.bed}` : 'For example: bathroom'} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="inc-what">What you saw</label>
        <textarea id="inc-what" className="textarea" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Found sitting on the floor beside the bed at 03:10. Said she slipped getting up to the toilet." />
      </div>
      {type === 'fall' && (
        <div className="neuro-box stack" style={{ gap: 12 }}>
          <div className="field">
            <span className="label">Did anyone see the fall?</span>
            <Choice label="Witnessed" value={witnessed} onChange={setWitnessed} options={[{ value: 'yes', label: 'Yes, someone saw it' }, { value: 'no', label: 'No, found on the floor' }]} />
          </div>
          <div className="field">
            <span className="label">Did they hit their head?</span>
            <Choice label="Head strike" value={head} onChange={setHead} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'not sure', label: 'Not sure' }]} />
          </div>
          {thinner && <Chip tone="warning" icon="drop">On a blood thinner: higher risk of bleeding in the head</Chip>}
          {neuro && <Banner tone="warning" icon="walk" title="Neuro observations needed">They will be scheduled for 24 hours: every 15 minutes for the first hour, then at 2, 4, 8, 12 and 24 hours.</Banner>}
        </div>
      )}
      <div className="field">
        <label htmlFor="inc-injury">Injury</label>
        <input id="inc-injury" className="input" value={injury} onChange={(e) => setInjury(e.target.value)} placeholder="None found, or describe it: small skin tear, left forearm" />
      </div>
      <div className="field">
        <span className="label">Level of harm</span>
        <div className="choice harm">
          {HARM.map((h) => (
            <button key={h.value} aria-pressed={harm === h.value} onClick={() => setHarm(h.value)}>
              <b>{h.label}</b><span className="tiny muted">{h.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="inc-action">What you did straight away</label>
        <textarea id="inc-action" className="textarea" style={{ minHeight: 80 }} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Checked for injury before moving, helped up with two staff, GCS 15, bed alarm on." />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}><input type="checkbox" checked={doctorTold} onChange={(e) => setDoctorTold(e.target.checked)} style={{ width: 20, height: 20 }} /><span className="small">The doctor has been told</span></label>
        <label className="row" style={{ gap: 10, cursor: 'pointer' }}><input type="checkbox" checked={familyTold} onChange={(e) => setFamilyTold(e.target.checked)} style={{ width: 20, height: 20 }} /><span className="small">The family has been told{r ? ` (${r.decisionMaker.name}, ${r.decisionMaker.relation.toLowerCase()})` : ''}</span></label>
      </div>
    </Sheet>
  )
}

export function IncidentSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { s, me, act, staff, go } = useApp()
  const i = s.incidents.find((x) => x.id === id)
  const [tell, setTell] = useState<'family' | 'doctor' | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [closing, setClosing] = useState(false)
  const blockers = useMemo(() => (i ? closeBlockers(s, i) : []), [s, i])
  if (!i) return null
  const r = residentOf(s, i.rid)!
  const h = harmOf(i.harm)
  const pf = i.type === 'fall' ? postFallProgress(s, i) : null
  const nm = me?.role === 'NM'
  const canTell = me && ['RN', 'EN', 'NM'].includes(me.role) && i.status !== 'closed'
  return (
    <Sheet title={`${typeLabel(i.type)} · ${fullName(r)}`} sub={`${when(i.t, s.day)} · ${i.where || 'Place not recorded'} · reported by ${staff(i.by)?.name}`} icon={INCIDENT_TYPES.find((x) => x.value === i.type)?.icon} tone={i.status === 'closed' ? 'ok' : isSerious(i) ? 'critical' : 'warning'} onClose={onClose} wide>
      <div className="row wrap" style={{ gap: 6 }}>
        <Chip tone={STATUS[i.status].tone} lg>{STATUS[i.status].label}</Chip>
        <Chip tone={h.tone} lg>{h.label}</Chip>
        {i.fall && <Chip lg>{i.fall.witnessed ? 'Witnessed' : 'Not witnessed'}</Chip>}
        {i.fall && <Chip tone={i.fall.headStrike === 'no' ? undefined : 'warning'} lg>Head strike: {i.fall.headStrike}</Chip>}
        {i.fall?.bloodThinner && <Chip tone="warning" lg>On a blood thinner</Chip>}
      </div>
      {i.mohDue && i.status !== 'closed' && <Banner tone="critical" icon="shield" title={`Notify MOH by ${when(i.mohDue, s.day)} (${until(i.mohDue, s.now)})`}>Preliminary notification within 72 hours, by the Head of Nursing or a key appointment holder (LC §21). Final report within 30 days.</Banner>}

      <dl className="kv">
        <dt>What happened</dt><dd>{i.what}</dd>
        <dt>Injury</dt><dd>{i.injury}</dd>
        {i.action && <><dt>Done straight away</dt><dd>{i.action}</dd></>}
      </dl>

      {pf && pf.total > 0 && (
        <div className="neuro-box row" style={{ gap: 14 }}>
          <Ring done={pf.done} total={pf.total} size={46} />
          <div className="grow">
            <b>{i.fall?.neuroObs ? 'Post-fall neuro observations' : 'Post-fall observations'}: {pf.done} of {pf.total}</b>
            <div className="small muted">{pf.next ? `Next ${clock(pf.next.due)}, ${until(pf.next.due, s.now)}` : 'All done'}</div>
          </div>
          {pf.next && i.status !== 'closed' && <button className="btn sm" onClick={() => { onClose(); go({ view: 'resident', rid: r.id, tab: 'vitals' }) }}>Record</button>}
        </div>
      )}

      <div className="field">
        <span className="label">Who has been told</span>
        <div className="told">
          {(['family', 'doctor'] as const).map((p) => {
            const t = i.told[p]
            return (
              <div key={p} className={`told-item${t ? ' done' : ''}`}>
                <Icon name={t ? 'check' : p === 'family' ? 'phone' : 'user'} size={20} />
                <div className="grow">
                  <b>{p === 'family' ? 'Family' : 'Doctor'}</b>
                  <span className="small muted">{t ? `${t.who} · ${t.how.toLowerCase()} · ${when(t.t, s.day)} by ${staff(t.by)?.short}` : p === 'family' ? `${r.decisionMaker.name} (${r.decisionMaker.relation.toLowerCase()}) · ${r.decisionMaker.phone}` : 'Not yet recorded'}</span>
                </div>
                {!t && canTell && <button className="btn sm" onClick={() => setTell(p)}>Record</button>}
              </div>
            )
          })}
        </div>
      </div>

      {i.review && (
        <div className="field">
          <span className="label">{i.type === 'fall' ? 'Post-fall analysis' : 'Review'} · {staff(i.review.by)?.name}, {when(i.review.t, s.day)}</span>
          {i.review.factors.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{i.review.factors.map((f) => <Chip key={f}>{f}</Chip>)}</div>}
          <p className="small">{i.review.findings}</p>
          {i.review.actions && <p className="small"><b>Actions:</b> {i.review.actions}</p>}
        </div>
      )}
      {i.closed && <Banner tone="ok" title={`Closed by ${staff(i.closed.by)?.name}, ${when(i.closed.t, s.day)}`}>{i.closed.summary}</Banner>}

      {i.status !== 'closed' && (
        nm ? (
          <div className="stack" style={{ gap: 10 }}>
            {blockers.length > 0 && <Banner tone="info" title="Before this can be closed">{blockers.join(' · ')}</Banner>}
            <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setReviewing(true)}>{i.review ? 'Edit review' : i.type === 'fall' ? 'Post-fall analysis' : 'Record the review'}</button>
              <button className="btn primary" disabled={blockers.length > 0} onClick={() => setClosing(true)}>Close the incident</button>
            </div>
          </div>
        ) : <p className="tiny muted">The nurse manager reviews and closes incidents.</p>
      )}

      {tell && <TellSheet i={i} party={tell} onClose={() => setTell(null)} />}
      {reviewing && <ReviewSheet i={i} onClose={() => setReviewing(false)} />}
      {closing && (
        <CloseSheet onClose={() => setClosing(false)} onDone={async (summary) => {
          const res = await act('incident.close', { id: i.id, summary }, { success: 'Incident closed.' })
          if (res.ok) setClosing(false)
        }} />
      )}
    </Sheet>
  )
}

function TellSheet({ i, party, onClose }: { i: Incident; party: 'family' | 'doctor'; onClose: () => void }) {
  const { s, act } = useApp()
  const r = residentOf(s, i.rid)!
  const doctor = s.staff.find((x) => x.role === 'DR')
  const [who, setWho] = useState(party === 'family' ? r.decisionMaker.name : doctor?.name ?? '')
  const [how, setHow] = useState('Phone call')
  return (
    <Sheet title={party === 'family' ? 'Family told' : 'Doctor told'} sub={`${typeLabel(i.type)} · ${fullName(r)}`} icon="phone" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!who.trim()} onClick={async () => {
        const res = await act('incident.tell', { id: i.id, party, who, how }, { success: 'Recorded.' })
        if (res.ok) onClose()
      }}>Record</button></>}>
      <div className="field">
        <label htmlFor="tell-who">Who you told</label>
        <input id="tell-who" className="input" value={who} onChange={(e) => setWho(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">How</span>
        <Choice label="How" value={how} onChange={setHow} options={['Phone call', 'In person', 'Message'].map((x) => ({ value: x, label: x }))} />
      </div>
    </Sheet>
  )
}

function ReviewSheet({ i, onClose }: { i: Incident; onClose: () => void }) {
  const { act } = useApp()
  const [factors, setFactors] = useState<string[]>(i.review?.factors ?? [])
  const [findings, setFindings] = useState(i.review?.findings ?? '')
  const [actions, setActions] = useState(i.review?.actions ?? '')
  const toggle = (f: string) => setFactors((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]))
  return (
    <Sheet title={i.type === 'fall' ? 'Post-fall analysis' : 'Incident review'} sub="What contributed, and what changes now" icon="search" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!findings.trim()} onClick={async () => {
        const res = await act('incident.review', { id: i.id, factors, findings, actions }, { success: 'Review saved.' })
        if (res.ok) onClose()
      }}>Save</button></>}>
      {i.type === 'fall' && (
        <div className="field">
          <span className="label">Contributing factors</span>
          <div className="choice">{FALL_FACTORS.map((f) => <button key={f} aria-pressed={factors.includes(f)} onClick={() => toggle(f)}>{f}</button>)}</div>
        </div>
      )}
      <div className="field">
        <label htmlFor="rv-find">What the review found</label>
        <textarea id="rv-find" className="textarea" value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Got up to the toilet at night without her frame. Bed alarm was off." />
      </div>
      <div className="field">
        <label htmlFor="rv-act">What changes now</label>
        <textarea id="rv-act" className="textarea" style={{ minHeight: 80 }} value={actions} onChange={(e) => setActions(e.target.value)} placeholder="Bed alarm on at night. Toilet round at 02:00. Frame within reach. Update the falls care plan." />
      </div>
    </Sheet>
  )
}

function CloseSheet({ onClose, onDone }: { onClose: () => void; onDone: (summary: string) => void }) {
  const [summary, setSummary] = useState('')
  return (
    <Sheet title="Close this incident?" sub="Closed incidents can no longer be changed." icon="check" tone="ok" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!summary.trim()} onClick={() => onDone(summary)}>Close incident</button></>}>
      <div className="field">
        <label htmlFor="cl-sum">Summary and lessons learned</label>
        <textarea id="cl-sum" className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Skin tear healing. Bed alarm and 02:00 toilet round in place. Shared at the ward huddle." />
      </div>
    </Sheet>
  )
}
