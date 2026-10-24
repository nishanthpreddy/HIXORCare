// What the nurse manager looks at: the whole ward at once, the last seven days, and what needs a manager's decision.
import { ASSESSMENTS, band, currentSlot, dateOf, dosesInSlot, findAdmin, fullName, levelTone, residentOf, scoreTone, slotMin, when, windowMin, awaitingVerification } from './clinical'
import { activeAlerts, latestAssessment, latestVitals, shiftNow, type Tone } from './selectors'
import type { Resident, Snapshot } from './types'

/** Home policy: risk assessments are repeated at least monthly, and on admission within 48 hours. */
export const ASSESSMENT_REVIEW_DAYS = 30
export const RISK_ASSESSMENTS = ['morse', 'braden', 'mna'] as const
/** An alert nobody has acknowledged after this many minutes is escalated to the nurse manager. */
export const ACK_ESCALATE_MIN = 10
export const TREND_DAYS = 7

/** when() for use mid-sentence: "yesterday 21:30" rather than "Yesterday 21:30". */
const at = (t: number, s: Snapshot) => when(t, s.day).replace(/^(Yesterday|Tomorrow)/, (m) => m.toLowerCase())
const dayStart = (s: Snapshot) => Math.floor(s.now / 1440) * 1440
const inHome = (r: Resident) => r.status === 'in'

export function occupancy(s: Snapshot) {
  const living = s.residents.filter(inHome)
  const away = s.residents.filter((r) => !inHome(r))
  const respite = s.residents.filter((r) => r.stay)
  const newAdmissions = s.residents.filter((r) => (dateOf(s.day).getTime() - new Date(r.admitted + 'T00:00:00Z').getTime()) / 86_400_000 <= 7 && !r.stay)
  return { beds: s.ward.beds, occupied: s.residents.length, vacant: s.ward.beds - s.residents.length, living, away, respite, newAdmissions }
}

export function onDuty(s: Snapshot) {
  const shift = shiftNow(s.now)
  const team = s.staff.filter((x) => x.shift === shift.id)
  const nurses = team.filter((x) => x.role === 'RN' || x.role === 'EN')
  const carers = team.filter((x) => x.role === 'CA')
  const managers = team.filter((x) => x.role === 'NM')
  const living = s.residents.filter(inHome).length
  return { shift, team, nurses, carers, managers, perNurse: nurses.length ? living / nurses.length : null }
}

export interface DayMeds { offset: number; label: string; onTime: number; late: number; notGiven: number; total: number }

/** Recorded doses per day for the last seven days, today included (today counts only what is recorded so far). */
export function medTrend(s: Snapshot): DayMeds[] {
  const days: DayMeds[] = []
  for (let off = -(TREND_DAYS - 1); off <= 0; off++) {
    const d = dateOf(s.day, off)
    const row: DayMeds = { offset: off, label: off === 0 ? 'Today' : d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' }), onTime: 0, late: 0, notGiven: 0, total: 0 }
    for (const a of s.administrations) {
      if (a.day !== off || a.outcome === 'discarded') continue
      const o = s.orders.find((x) => x.id === a.orderId)
      if (!o) continue
      row.total++
      if (a.outcome !== 'given') row.notGiven++
      else if (a.t - (off * 1440 + slotMin(a.slot)) > windowMin(o)) row.late++
      else row.onTime++
    }
    days.push(row)
  }
  return days
}

export function medSummary(s: Snapshot) {
  const trend = medTrend(s)
  const sum = (k: keyof Omit<DayMeds, 'offset' | 'label'>) => trend.reduce((n, d) => n + d[k], 0)
  const total = sum('total')
  const given = sum('onTime') + sum('late')
  // Doses due earlier today that are past their window with nothing recorded.
  const overdue: { rid: string; drug: string; slot: string; timeCritical: boolean }[] = []
  for (const slot of [...new Set(s.orders.flatMap((o) => o.slots))].sort()) {
    for (const o of dosesInSlot(s, slot)) {
      const r = residentOf(s, o.rid)!
      if (!inHome(r) || findAdmin(s, o.id, slot)) continue
      if (s.now > dayStart(s) + slotMin(slot) + windowMin(o)) overdue.push({ rid: r.id, drug: o.drug.split(' (')[0], slot, timeCritical: !!o.timeCritical })
    }
  }
  return { trend, total, onTimePct: given ? Math.round((sum('onTime') / given) * 100) : null, late: sum('late'), notGiven: sum('notGiven'), overdue, slot: currentSlot(s) }
}

export interface Pattern { key: string; rid: string; tone: Tone; title: string; detail: string; tab: string }

/** Things worth a manager's review: repeated refusals, frequent PRN use, psychotropic reviews and CD register corrections. */
export function patterns(s: Snapshot): Pattern[] {
  const out: Pattern[] = []
  const since = dayStart(s) - (TREND_DAYS - 1) * 1440
  const byOrder = new Map<string, { refused: number; held: number; due: number }>()
  for (const a of s.administrations) {
    if (a.t < since || a.outcome === 'discarded') continue
    const x = byOrder.get(a.orderId) ?? { refused: 0, held: 0, due: 0 }
    x.due++
    if (a.outcome === 'refused') x.refused++
    if (a.outcome === 'held') x.held++
    byOrder.set(a.orderId, x)
  }
  for (const [oid, x] of byOrder) {
    const o = s.orders.find((y) => y.id === oid)!
    const r = residentOf(s, o.rid)!
    const drug = o.drug.split(' (')[0]
    if (x.refused >= 2) out.push({ key: `ref-${oid}`, rid: r.id, tone: 'warning', tab: 'meds', title: `${drug} refused ${x.refused} of ${x.due} times`, detail: `${fullName(r)} · last ${TREND_DAYS} days. Review timing or form with the doctor.` })
    if (x.held >= 1) out.push({ key: `held-${oid}`, rid: r.id, tone: 'caution', tab: 'meds', title: `${drug} held ${x.held === 1 ? 'once' : `${x.held} times`}`, detail: `${fullName(r)} · ${o.check ? `${o.check.label} below ${o.check.holdBelow} ${o.check.unit}` : 'hold parameter'}. Ask the doctor to review the dose.` })
  }
  for (const o of s.orders.filter((x) => x.prn)) {
    const n = s.prn.filter((p) => p.orderId === o.id && p.t >= since).length
    if (!n) continue
    const r = residentOf(s, o.rid)!
    out.push({ key: `prn-${o.id}`, rid: r.id, tone: o.cd ? 'warning' : 'caution', tab: 'meds', title: `${o.drug.split(' (')[0]} PRN used ${n === 1 ? 'once' : `${n} times`}`, detail: `${fullName(r)} · last ${TREND_DAYS} days${o.cd ? ' · controlled drug' : ''}.` })
  }
  for (const o of s.orders.filter((x) => x.review && !x.stopped)) {
    const days = Math.round((new Date(o.review + 'T00:00:00Z').getTime() - dateOf(s.day).getTime()) / 86_400_000)
    if (days > 21) continue
    const r = residentOf(s, o.rid)!
    out.push({ key: `rev-${o.id}`, rid: r.id, tone: days < 0 ? 'critical' : 'accent', tab: 'meds', title: `${o.drug.split(' (')[0]} review ${days < 0 ? 'overdue' : `due ${dateOf(s.day, days).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`}`, detail: `${fullName(r)} · ${o.classes.includes('antipsychotic') ? 'antipsychotic, 3-monthly review' : 'scheduled review'}.` })
  }
  for (const e of s.cdLedger.filter((x) => x.kind === 'correction' && x.t >= since)) {
    const o = s.orders.find((y) => y.id === e.orderId)!
    const r = residentOf(s, o.rid)!
    out.push({ key: `cd-${e.seq}`, rid: r.id, tone: 'warning', tab: 'meds', title: `CD register correction: ${o.drug.split(' (')[0]}`, detail: `${when(e.t, s.day)} · ${e.change > 0 ? '+' : ''}${e.change} ${s.cdStock[o.id]?.unit ?? ''}. ${e.note}` })
  }
  const rank: Record<Tone, number> = { critical: 0, warning: 1, caution: 2, accent: 3, ok: 4 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}

export interface RiskCell { label: string; tone: string; title: string }
export interface RiskRow { r: Resident; news2: RiskCell | null; cells: Record<string, RiskCell | null>; wound: RiskCell | null; alerts: number; weight: number }

/** One row per resident: latest NEWS2, risk assessment bands, wounds and open alerts. Highest risk first. */
export function riskRegister(s: Snapshot): RiskRow[] {
  const rows = s.residents.map((r) => {
    const v = latestVitals(s, r.id)
    const news2 = v ? { label: String(v.news2), tone: scoreTone(v.news2), title: `NEWS2 ${v.news2} at ${when(v.t, s.day)}` } : null
    const cells: Record<string, RiskCell | null> = {}
    let weight = v ? v.news2 * 2 : 0
    for (const type of [...RISK_ASSESSMENTS, 'abbey']) {
      const a = latestAssessment(s, r.id, type)
      if (!a) { cells[type] = null; continue }
      const b = band(type, a.score)
      cells[type] = { label: b.label === 'No risk' ? b.label : b.label.replace(/ risk$/, '').replace('Normal nutrition', 'Normal').replace('At risk of malnutrition', 'At risk'), tone: levelTone(b.level), title: `${ASSESSMENTS[type].name}: ${a.score}, ${b.label} (${when(a.t, s.day)})` }
      weight += b.level === 'high' ? 3 : b.level === 'medium' ? 2 : 0
    }
    const ws = s.wounds.filter((w) => w.rid === r.id)
    let wound: RiskCell | null = null
    if (ws.length) {
      const trends = ws.map((w) => {
        const m = [...w.measurements].sort((a, b) => a.t - b.t)
        if (m.length < 2) return 'new'
        const area = (x: (typeof m)[number]) => x.length * x.width
        return area(m[m.length - 1]) < area(m[0]) ? 'healing' : 'worse'
      })
      const worse = trends.includes('worse')
      wound = { label: `${ws.length} · ${worse ? 'worse' : trends.includes('new') ? 'new' : 'healing'}`, tone: worse ? 'critical' : trends.includes('new') ? 'warning' : 'ok', title: ws.map((w, i) => `${w.site}: ${trends[i]}`).join(' · ') }
      weight += worse ? 3 : 1
    }
    const alerts = activeAlerts(s, r.id).filter((a) => a.kind !== 'hospital').length
    weight += alerts * 2
    return { r, news2, cells, wound, alerts, weight: inHome(r) ? weight : -1 }
  })
  return rows.sort((a, b) => b.weight - a.weight)
}

const dueLabel = (d: number) => (d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`)

export interface DueItem { key: string; rid: string; tone: Tone; what: string; status: string; dueDays: number; tab: string }

/** Assessments and care plan reviews that are not done, overdue or due within two weeks. */
export function reviewsDue(s: Snapshot): DueItem[] {
  const out: DueItem[] = []
  const today = dateOf(s.day).getTime()
  for (const r of s.residents.filter(inHome)) {
    const isNew = (today - new Date(r.admitted + 'T00:00:00Z').getTime()) / 86_400_000 <= 2
    for (const type of RISK_ASSESSMENTS) {
      const a = latestAssessment(s, r.id, type)
      const name = ASSESSMENTS[type].name.replace(/ \(.*\)/, '')
      if (!a) {
        out.push({ key: `${r.id}-${type}`, rid: r.id, tone: isNew ? 'warning' : 'critical', what: name, status: isNew ? 'Admission, due in 48 h' : 'Never done', dueDays: isNew ? 1 : -99, tab: 'assess' })
        continue
      }
      const due = Math.floor(a.t / 1440) + ASSESSMENT_REVIEW_DAYS
      if (due <= 14) out.push({ key: `${r.id}-${type}`, rid: r.id, tone: due < 0 ? 'critical' : due <= 3 ? 'warning' : 'accent', what: name, status: dueLabel(due), dueDays: due, tab: 'assess' })
    }
  }
  for (const c of s.carePlans) {
    const r = residentOf(s, c.rid)
    if (!r || !inHome(r)) continue
    if (!c.signedBy) { out.push({ key: `cp-${c.rid}`, rid: c.rid, tone: 'warning', what: 'Care plan', status: 'Not yet signed', dueDays: 0, tab: 'care' }); continue }
    if (!c.reviewDue) continue
    const due = Math.round((new Date(c.reviewDue + 'T00:00:00Z').getTime() - today) / 86_400_000)
    if (due <= 14) out.push({ key: `cp-${c.rid}`, rid: c.rid, tone: due < 0 ? 'critical' : due <= 3 ? 'warning' : 'accent', what: 'Care plan review', status: dueLabel(due), dueDays: due, tab: 'care' })
  }
  return out.sort((a, b) => a.dueDays - b.dueDays)
}

export interface ManagerItem { key: string; rid: string | null; tone: Tone; title: string; detail: string; to: 'resident' | 'alerts' | 'audit'; tab?: string }

/** Decisions and sign-offs that sit with the nurse manager, most urgent first. */
export function managerQueue(s: Snapshot): ManagerItem[] {
  const out: ManagerItem[] = []
  for (const a of activeAlerts(s)) {
    const r = a.rid ? residentOf(s, a.rid) : null
    if (a.status === 'open' && s.now - a.t >= ACK_ESCALATE_MIN && a.severity !== 'low') {
      const waited = s.now - a.t >= 120 ? `${Math.floor((s.now - a.t) / 60)} h` : `${Math.round(s.now - a.t)} min`
      out.push({ key: a.id, rid: a.rid, tone: a.severity === 'high' ? 'critical' : 'warning', title: a.title, detail: `${r ? `${fullName(r)} · ` : ''}not acknowledged for ${waited} (raised ${at(a.t, s)})`, to: 'alerts' })
    }
  }
  for (const r of s.residents) {
    const waiting = s.orders.filter((o) => o.rid === r.id && awaitingVerification(o))
    if (waiting.length && !activeAlerts(s, r.id).some((a) => a.kind === 'transcription')) {
      const tr = waiting[0].transcribed!
      out.push({ key: `tr-${r.id}`, rid: r.id, tone: 'warning', title: `${waiting.length} admission medicines not verified`, detail: `${fullName(r)} · transcribed ${at(tr.t, s)} by ${s.staff.find((x) => x.id === tr.by)?.short}. Doctor to endorse by ${at(tr.endorseDue, s)}.`, to: 'resident', tab: 'meds' })
    }
    if (r.status !== 'in') out.push({ key: `away-${r.id}`, rid: r.id, tone: 'accent', title: `${fullName(r)} is in hospital`, detail: `${r.statusNote ?? ''} Bed ${r.bed} held.`, to: 'resident' })
    if (r.stay) {
      const days = Math.round((new Date(r.stay.to + 'T00:00:00Z').getTime() - dateOf(s.day).getTime()) / 86_400_000)
      if (days <= 7) out.push({ key: `stay-${r.id}`, rid: r.id, tone: 'accent', title: `Respite ends in ${days} days`, detail: `${fullName(r)} · plan discharge medicines and handover to family.`, to: 'resident' })
    }
  }
  const rank: Record<Tone, number> = { critical: 0, warning: 1, caution: 2, accent: 3, ok: 4 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}

export function cdOverview(s: Snapshot) {
  return Object.entries(s.cdStock).map(([oid, st]) => {
    const o = s.orders.find((x) => x.id === oid)!
    const last = s.cdLedger.filter((e) => e.orderId === oid).sort((a, b) => b.seq - a.seq)[0]
    return { o, r: residentOf(s, o.rid)!, balance: st.balance, unit: st.unit, last }
  })
}

