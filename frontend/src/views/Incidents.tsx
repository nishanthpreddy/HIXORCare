import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Banner, Chip, Choice, Ring, Sheet } from '../ui/kit'
import { clock, fullName, isManager, residentOf, until, when } from '../domain/clinical'
import {
  FALL_FACTORS, HARM, INCIDENT_TYPES, RCA_DAYS, closeBlockers, harmOf, isSerious, mohStage, mustEscalate, needsNeuro, onBloodThinner, postFallProgress, typeLabel,
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
  const [step, setStep] = useState<'escalate' | 'moh' | 'rca' | null>(null)
  const blockers = useMemo(() => (i ? closeBlockers(s, i) : []), [s, i])
  if (!i) return null
  const r = residentOf(s, i.rid)!
  const h = harmOf(i.harm)
  const pf = i.type === 'fall' ? postFallProgress(s, i) : null
  const nm = isManager(me?.role)
  const hon = me?.role === 'HON'
  const canTell = me && ['RN', 'EN', 'NM', 'HON'].includes(me.role) && i.status !== 'closed'
  const canEscalate = me && ['RN', 'NM'].includes(me.role) && !i.escalated && i.status !== 'closed'
  const stage = mohStage(i)
  const closeLocked = !!i.escalated && !hon
  return (
    <Sheet title={`${typeLabel(i.type)} · ${fullName(r)}`} sub={`${when(i.t, s.day)} · ${i.where || 'Place not recorded'} · reported by ${staff(i.by)?.name}`} icon={INCIDENT_TYPES.find((x) => x.value === i.type)?.icon} tone={i.status === 'closed' ? 'ok' : isSerious(i) ? 'critical' : 'warning'} onClose={onClose} wide>
      <div className="row wrap" style={{ gap: 6 }}>
        <Chip tone={STATUS[i.status].tone} lg>{STATUS[i.status].label}</Chip>
        <Chip tone={h.tone} lg>{h.label}</Chip>
        {i.fall && <Chip lg>{i.fall.witnessed ? 'Witnessed' : 'Not witnessed'}</Chip>}
        {i.fall && <Chip tone={i.fall.headStrike === 'no' ? undefined : 'warning'} lg>Head strike: {i.fall.headStrike}</Chip>}
        {i.fall?.bloodThinner && <Chip tone="warning" lg>On a blood thinner</Chip>}
      </div>
      {stage !== 'none' && <MohSteps i={i} canEscalate={!!canEscalate} hon={hon} onStep={setStep} />}

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
              {stage === 'none' && canEscalate && <button className="btn ghost" onClick={() => setStep('escalate')}>Escalate to Head of Nursing</button>}
              <button className="btn primary" disabled={blockers.length > 0 || closeLocked} onClick={() => setClosing(true)}>Close the incident</button>
            </div>
            {closeLocked && <p className="tiny muted" style={{ textAlign: 'right' }}>Escalated incidents are signed off and closed by the Head of Nursing.</p>}
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {stage === 'none' && canEscalate && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setStep('escalate')}>Escalate to Head of Nursing</button></div>}
            <p className="tiny muted">The nurse manager reviews and closes incidents.</p>
          </div>
        )
      )}
      {step === 'escalate' && <EscalateSheet i={i} onClose={() => setStep(null)} />}
      {step === 'moh' && <MohSheet i={i} onClose={() => setStep(null)} />}
      {step === 'rca' && <RcaSheet i={i} onClose={() => setStep(null)} />}

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

/** The MOH reporting chain: nurse manager escalates, Head of Nursing notifies MOH within 72 hours, then submits the RCA within 30 days. */
function MohSteps({ i, canEscalate, hon, onStep }: { i: Incident; canEscalate: boolean; hon: boolean; onStep: (s: 'escalate' | 'moh' | 'rca') => void }) {
  const { s, staff } = useApp()
  const stage = mohStage(i)
  const open = i.status !== 'closed'
  const late = (t?: number) => t !== undefined && t < s.now
  const steps = [
    {
      key: 'escalate', title: 'Escalated to the Head of Nursing',
      done: i.escalated && `${staff(i.escalated.by)?.name}, ${when(i.escalated.t, s.day)}. ${i.escalated.note}`,
      todo: mustEscalate(i) ? 'Required now: abuse allegation or moderate to severe harm. Send the preliminary report.' : 'Optional for this incident.',
      action: open && stage === 'escalate' && canEscalate ? 'Escalate' : null,
    },
    {
      key: 'moh', title: i.moh?.decision === 'not-reportable' ? 'Not reportable to MOH' : 'MOH notified',
      done: i.moh && (i.moh.decision === 'notified' ? `FormSG reference ${i.moh.ref} · ${staff(i.moh.by)?.name}, ${when(i.moh.t, s.day)}` : `${i.moh.reason} · ${staff(i.moh.by)?.name}, ${when(i.moh.t, s.day)}`),
      todo: i.mohDue ? `Head of Nursing reviews and notifies MOH by ${when(i.mohDue, s.day)} (${until(i.mohDue, s.now)}).` : 'Head of Nursing reviews and notifies MOH within 72 hours.',
      urgent: late(i.mohDue), action: open && stage === 'notify' && hon ? 'Record decision' : null,
    },
    ...(i.moh?.decision === 'not-reportable' ? [] : [{
      key: 'rca', title: 'Final RCA submitted to MOH',
      done: i.rca && `Reference ${i.rca.ref} · ${staff(i.rca.by)?.name}, ${when(i.rca.t, s.day)}. ${i.rca.summary}`,
      todo: i.rcaDue ? `Due ${when(i.rcaDue, s.day)} (${until(i.rcaDue, s.now)}), ${RCA_DAYS} calendar days.` : `Within ${RCA_DAYS} calendar days.`,
      urgent: late(i.rcaDue), action: open && stage === 'rca' && hon ? 'Submit RCA' : null,
    }]),
  ]
  return (
    <div className="moh-steps" aria-label="MOH reporting">
      <div className="row" style={{ gap: 8 }}><Icon name="shield" size={18} /><b>MOH reporting</b><span className="spacer" /><span className="tiny muted">LC §21 · HCSA</span></div>
      {steps.map((x, n) => (
        <div key={x.key} className={`moh-step${x.done ? ' done' : ''}${!x.done && 'urgent' in x && x.urgent ? ' late' : ''}`}>
          <span className="moh-dot">{x.done ? <Icon name="check" size={14} /> : n + 1}</span>
          <div className="grow">
            <b>{x.done ? x.title : x.key === 'moh' ? 'Notify MOH' : x.key === 'rca' ? 'Submit the final RCA' : 'Escalate to the Head of Nursing'}</b>
            <span className="small muted">{x.done || x.todo}</span>
          </div>
          {x.action && <button className="btn sm primary" onClick={() => onStep(x.key as 'escalate' | 'moh' | 'rca')}>{x.action}</button>}
        </div>
      ))}
    </div>
  )
}

function EscalateSheet({ i, onClose }: { i: Incident; onClose: () => void }) {
  const { s, act } = useApp()
  const r = residentOf(s, i.rid)!
  const hon = s.staff.find((x) => x.role === 'HON')
  const told = [i.told.family && 'family told', i.told.doctor && 'doctor told'].filter(Boolean).join(', ')
  const stop = (x: string) => x.trim().replace(/\.*$/, '.')
  const at = when(i.t, s.day).replace(/^(Yesterday|Tomorrow)/, (m) => m.toLowerCase())
  const [note, setNote] = useState(`${typeLabel(i.type)}, ${harmOf(i.harm).label.toLowerCase()}, ${at}. ${stop(i.what)} Injury: ${stop(i.injury)} ${i.action ? stop(i.action) : ''}${told ? ` ${told[0].toUpperCase() + told.slice(1)}.` : ''}`)
  return (
    <Sheet title="Escalate to the Head of Nursing" sub={`${typeLabel(i.type)} · ${fullName(r)}`} icon="shield" tone="hi" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!note.trim()} onClick={async () => {
        const res = await act('incident.escalate', { id: i.id, note }, { success: 'Escalated.' })
        if (res.ok) onClose()
      }}>Send to {hon?.short ?? 'Head of Nursing'}</button></>}>
      <Banner tone="info" title="The 72-hour MOH clock starts now">{hon?.name ?? 'The Head of Nursing'} reviews the report, signs off and submits the notification to MOH. The final RCA is due within {RCA_DAYS} days.</Banner>
      <div className="field">
        <label htmlFor="esc-note">Preliminary report</label>
        <textarea id="esc-note" className="textarea" style={{ minHeight: 150 }} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="tiny muted">Drafted from the incident record. Check it and add anything the Head of Nursing needs to know.</span>
      </div>
    </Sheet>
  )
}

function MohSheet({ i, onClose }: { i: Incident; onClose: () => void }) {
  const { s, act } = useApp()
  const r = residentOf(s, i.rid)!
  const [decision, setDecision] = useState<'notified' | 'not-reportable'>('notified')
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const ok = decision === 'notified' ? ref.trim() : reason.trim()
  return (
    <Sheet title="MOH notification" sub={`${typeLabel(i.type)} · ${fullName(r)}`} icon="shield" tone="hi" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={async () => {
        const res = await act('incident.moh', { id: i.id, decision, ref, reason }, { success: decision === 'notified' ? 'MOH notification recorded.' : 'Decision recorded.' })
        if (res.ok) onClose()
      }}>Sign off</button></>}>
      <p className="small">Submit the preliminary notification on FormSG, then record the reference here. Your sign-off is kept in the audit trail.</p>
      <div className="field">
        <span className="label">Decision</span>
        <Choice label="Decision" value={decision} onChange={setDecision} options={[
          { value: 'notified', label: 'Notified MOH' },
          ...(i.type === 'abuse' ? [] : [{ value: 'not-reportable' as const, label: 'Not reportable' }]),
        ]} />
      </div>
      {decision === 'notified' ? (
        <div className="field">
          <label htmlFor="moh-ref">FormSG submission reference</label>
          <input id="moh-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 6721a0c3e4b0" />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="moh-why">Why it is not reportable</label>
          <textarea id="moh-why" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Laceration sutured at A&E, CT head clear, no lasting harm. Below the SRE threshold of the home's risk matrix." />
        </div>
      )}
    </Sheet>
  )
}

function RcaSheet({ i, onClose }: { i: Incident; onClose: () => void }) {
  const { s, act } = useApp()
  const r = residentOf(s, i.rid)!
  const [ref, setRef] = useState('')
  const [summary, setSummary] = useState(i.review ? `${i.review.findings}${i.review.actions ? ` Actions: ${i.review.actions}` : ''}` : '')
  return (
    <Sheet title="Final RCA report" sub={`${typeLabel(i.type)} · ${fullName(r)}`} icon="shield" tone="hi" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ref.trim() || !summary.trim()} onClick={async () => {
        const res = await act('incident.rca', { id: i.id, ref, summary }, { success: 'RCA recorded.' })
        if (res.ok) onClose()
      }}>Record submission</button></>}>
      <div className="field">
        <label htmlFor="rca-ref">Submission reference</label>
        <input id="rca-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="rca-sum">Root causes and actions</label>
        <textarea id="rca-sum" className="textarea" style={{ minHeight: 130 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
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
