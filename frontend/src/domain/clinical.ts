// Clinical rules. The backend (backend/app/rules.py) implements the same rules
// and is the authority; these copies drive live previews and the demo mode.
import assessmentDefs from '../../../shared/assessments.json'
import type { Administration, Allergy, DecoyPack, Order, Resident, Snapshot, Vitals } from './types'

// ---------- NEWS2 (Royal College of Physicians, SpO2 scale 1) ----------

export type VitalsInput = Pick<Vitals, 'rr' | 'spo2' | 'o2' | 'sbp' | 'pulse' | 'acvpu' | 'temp'>

export interface News2Part { key: keyof VitalsInput; label: string; score: number }

export function news2Parts(v: VitalsInput): News2Part[] {
  const rr = v.rr <= 8 ? 3 : v.rr <= 11 ? 1 : v.rr <= 20 ? 0 : v.rr <= 24 ? 2 : 3
  const spo2 = v.spo2 <= 91 ? 3 : v.spo2 <= 93 ? 2 : v.spo2 <= 95 ? 1 : 0
  const o2 = v.o2 ? 2 : 0
  const sbp = v.sbp <= 90 ? 3 : v.sbp <= 100 ? 2 : v.sbp <= 110 ? 1 : v.sbp <= 219 ? 0 : 3
  const pulse = v.pulse <= 40 ? 3 : v.pulse <= 50 ? 1 : v.pulse <= 90 ? 0 : v.pulse <= 110 ? 1 : v.pulse <= 130 ? 2 : 3
  const acvpu = v.acvpu === 'A' ? 0 : 3
  const temp = v.temp <= 35 ? 3 : v.temp <= 36 ? 1 : v.temp <= 38 ? 0 : v.temp <= 39 ? 1 : 2
  return [
    { key: 'rr', label: 'Respiration rate', score: rr },
    { key: 'spo2', label: 'SpO₂', score: spo2 },
    { key: 'o2', label: 'Air or oxygen', score: o2 },
    { key: 'sbp', label: 'Systolic BP', score: sbp },
    { key: 'pulse', label: 'Pulse', score: pulse },
    { key: 'acvpu', label: 'Consciousness', score: acvpu },
    { key: 'temp', label: 'Temperature', score: temp },
  ]
}

export const news2 = (v: VitalsInput) => news2Parts(v).reduce((s, p) => s + p.score, 0)

export type Risk = 'low' | 'low-single' | 'medium' | 'high'

export function news2Risk(v: VitalsInput): Risk {
  const parts = news2Parts(v)
  const total = parts.reduce((s, p) => s + p.score, 0)
  if (total >= 7) return 'high'
  if (total >= 5) return 'medium'
  if (parts.some((p) => p.score === 3)) return 'low-single'
  return 'low'
}

// The home sets the response to each band; NEWS2 itself is fixed.
export const ESCALATION: Record<Risk, { label: string; action: string; obsEveryMin: number; alert: boolean }> = {
  low: { label: 'Low', action: 'Routine observations every 12 hours.', obsEveryMin: 720, alert: false },
  'low-single': { label: 'Low (single red score)', action: 'Nurse in charge to review within 1 hour. Observations every hour.', obsEveryMin: 60, alert: true },
  medium: { label: 'Medium', action: 'Nurse in charge now. Observations every hour. Inform the doctor.', obsEveryMin: 60, alert: true },
  high: { label: 'High', action: 'Emergency response. Call the doctor now, check the advance care plan, consider 995. Continuous monitoring.', obsEveryMin: 30, alert: true },
}

export const riskTone = (r: Risk) => (r === 'high' ? 'critical' : r === 'medium' ? 'warning' : r === 'low-single' ? 'caution' : 'ok')
export const scoreTone = (n: number) => (n >= 7 ? 'critical' : n >= 5 ? 'warning' : n >= 1 ? 'caution' : 'ok')

// ---------- Assessments ----------

export interface AssessmentDef {
  name: string
  short: string
  minutes: number
  lowerIsWorse?: boolean
  items: { id: string; label: string; options: { label: string; score: number }[] }[]
  bands: { min: number; max: number; label: string; level: string }[]
  suggest: Record<string, string[]>
}

export const ASSESSMENTS = assessmentDefs as Record<string, AssessmentDef>

export function band(type: string, score: number) {
  const def = ASSESSMENTS[type]
  return def.bands.find((b) => score >= b.min && score <= b.max) ?? def.bands[def.bands.length - 1]
}

export const levelTone = (level: string) => (level === 'high' ? 'critical' : level === 'medium' ? 'warning' : level === 'low' ? 'caution' : 'ok')

// ---------- Time ----------

export const slotMin = (slot: string) => {
  const [h, m] = slot.split(':').map(Number)
  return h * 60 + m
}

export function clock(t: number) {
  const d = ((t % 1440) + 1440) % 1440
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`
}

export function dayOffset(t: number) {
  return Math.floor(t / 1440)
}

/** "08:12", "Yesterday 22:00", "Thu 19:40", "3 Oct" */
export function when(t: number, day: string) {
  const off = dayOffset(t)
  if (off === 0) return clock(t)
  if (off === -1) return `Yesterday ${clock(t)}`
  if (off === 1) return `Tomorrow ${clock(t)}`
  const d = dateOf(day, off)
  if (off > -7 && off < 0) return `${d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' })} ${clock(t)}`
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function dateOf(day: string, offset = 0) {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + offset)
  return d
}

export function ago(t: number, now: number) {
  const m = Math.round(now - t)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ''}ago`
  const d = Math.floor(m / 1440)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function until(t: number, now: number) {
  const m = Math.round(t - now)
  if (m <= 0) return m === 0 ? 'now' : `${-m} min overdue`
  if (m < 60) return `in ${m} min`
  return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

export function age(dob: string, day: string) {
  const b = new Date(dob + 'T00:00:00Z')
  const d = new Date(day + 'T00:00:00Z')
  let a = d.getUTCFullYear() - b.getUTCFullYear()
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) a--
  return a
}

export const fullName = (r: Resident) => `${r.salutation} ${r.name}`

// ---------- Medication rounds ----------

export type DoseState = 'done' | 'due' | 'overdue' | 'upcoming' | 'late' | 'suspended'

/** Window either side of the due time in which a dose counts as on time. */
export const windowMin = (o: Order) => (o.timeCritical ? 30 : 60)

export function isDueToday(o: Order, day: string) {
  if (o.weekly === undefined) return true
  return dateOf(day).getUTCDay() === o.weekly
}

export function doseState(o: Order, slot: string, now: number, admin: Administration | undefined, r: Resident): DoseState {
  if (admin) return 'done'
  if (r.status !== 'in') return 'suspended'
  const due = slotMin(slot)
  const w = windowMin(o)
  if (now < due - w) return 'upcoming'
  if (now <= due + w) return 'due'
  return 'overdue'
}

export function findAdmin(s: Snapshot, orderId: string, slot: string, day = 0) {
  return s.administrations.find((a) => a.orderId === orderId && a.slot === slot && a.day === day)
}

/** Every scheduled dose today, by slot. */
export function roundsToday(s: Snapshot) {
  const slots = new Set<string>()
  for (const o of s.orders) if (!o.prn && isDueToday(o, s.day)) o.slots.forEach((x) => slots.add(x))
  return [...slots].sort()
}

export function dosesInSlot(s: Snapshot, slot: string) {
  return s.orders.filter((o) => !o.prn && o.slots.includes(slot) && isDueToday(o, s.day))
}

/** The slot a nurse is most likely working on now. */
export function currentSlot(s: Snapshot) {
  const slots = roundsToday(s)
  const open = slots.find((sl) => {
    const due = slotMin(sl)
    if (s.now > due + 60 || s.now < due - 60) return false
    return dosesInSlot(s, sl).some((o) => !findAdmin(s, o.id, sl) && residentOf(s, o.rid)?.status === 'in')
  })
  if (open) return open
  return slots.find((sl) => slotMin(sl) + 60 >= s.now) ?? slots[slots.length - 1]
}

export const residentOf = (s: Snapshot, rid: string) => s.residents.find((r) => r.id === rid)

export const sachetBarcode = (rid: string, day: string, slot: string) => `SCH-${rid.slice(2).toUpperCase()}-${day.replaceAll('-', '')}-${slot.replace(':', '')}`
export const packBarcode = (orderId: string) => `PK-${orderId.slice(2).toUpperCase()}`

export function allergyClash(allergies: Allergy[], classes: string[]) {
  return allergies.find((a) => a.classes.some((c) => classes.includes(c)))
}

export interface ScanResult {
  ok: boolean
  kind: 'match' | 'wrong-resident' | 'allergy' | 'not-prescribed' | 'wrong-time'
  title: string
  detail: string
  orderIds: string[]
}

/** What happens when a nurse scans a barcode while giving `rid` their `slot` doses. */
export function verifyScan(s: Snapshot, rid: string, slot: string, barcode: string, decoys: DecoyPack[]): ScanResult {
  const r = residentOf(s, rid)!
  const due = dosesInSlot(s, slot).filter((o) => o.rid === rid)
  const decoy = decoys.find((d) => d.barcode === barcode)
  if (decoy) {
    const clash = allergyClash(r.allergies, decoy.classes)
    if (clash) {
      return {
        ok: false, kind: 'allergy', orderIds: [],
        title: `Stop. ${r.preferred} is allergic to ${clash.substance.toLowerCase()}.`,
        detail: `${decoy.label} contains a ${clash.classes[0].replace('-', ' ')}. Recorded reaction: ${clash.reaction}. It is also not prescribed for ${fullName(r)}. Put the pack aside and tell the nurse in charge.`,
      }
    }
    return { ok: false, kind: 'not-prescribed', orderIds: [], title: 'Not prescribed for this resident', detail: `${decoy.label} is not on ${fullName(r)}'s chart. Put it aside.` }
  }
  if (barcode.startsWith('SCH-')) {
    if (barcode === sachetBarcode(rid, s.day, slot)) {
      const ids = due.filter((o) => o.supply === 'sachet').map((o) => o.id)
      return { ok: true, kind: 'match', orderIds: ids, title: 'Sachet matches', detail: `${ids.length} medicine${ids.length === 1 ? '' : 's'} for ${slot}.` }
    }
    const other = s.residents.find((x) => barcode.startsWith(`SCH-${x.id.slice(2).toUpperCase()}-`))
    if (other && other.id !== rid) {
      return { ok: false, kind: 'wrong-resident', orderIds: [], title: 'Wrong resident', detail: `This sachet belongs to ${fullName(other)} (${other.bed}). Do not give it.` }
    }
    return { ok: false, kind: 'wrong-time', orderIds: [], title: 'Wrong time', detail: `This sachet is not for the ${slot} round.` }
  }
  const order = s.orders.find((o) => packBarcode(o.id) === barcode)
  if (!order) return { ok: false, kind: 'not-prescribed', orderIds: [], title: 'Unknown barcode', detail: 'This barcode is not on any chart in this ward.' }
  if (order.rid !== rid) {
    const other = residentOf(s, order.rid)!
    return { ok: false, kind: 'wrong-resident', orderIds: [], title: 'Wrong resident', detail: `This pack is ${order.drug} for ${fullName(other)} (${other.bed}).` }
  }
  if (!order.prn && !order.slots.includes(slot)) {
    return { ok: false, kind: 'wrong-time', orderIds: [], title: 'Not due now', detail: `${order.drug} is due at ${order.slots.join(', ')}.` }
  }
  return { ok: true, kind: 'match', orderIds: [order.id], title: 'Pack matches', detail: `${order.drug} ${order.dose}.` }
}

export function needsWitness(o: Order) {
  return !!(o.highAlert || o.cd)
}

export function checkAdvice(o: Order, value: number | undefined) {
  if (!o.check || value === undefined || Number.isNaN(value)) return null
  if (o.check.holdBelow !== undefined && value < o.check.holdBelow) {
    return { tone: 'critical' as const, text: `${o.check.label} is below ${o.check.holdBelow} ${o.check.unit}. Hold this dose and tell the nurse in charge.` }
  }
  if (o.check.warnAbove !== undefined && value > o.check.warnAbove) {
    return { tone: 'warning' as const, text: `${o.check.label} is above ${o.check.warnAbove} ${o.check.unit}. Give, and inform the doctor.` }
  }
  return { tone: 'ok' as const, text: 'Within range.' }
}

export function prnStatus(s: Snapshot, o: Order) {
  const doses = s.prn.filter((p) => p.orderId === o.id).sort((a, b) => b.t - a.t)
  const last = doses[0]
  const in24 = doses.filter((p) => p.t > s.now - 1440).length
  const nextOk = last ? last.t + o.prn!.minHours * 60 : -Infinity
  const blockedReason = in24 >= o.prn!.maxPer24h
    ? `Maximum of ${o.prn!.maxPer24h} doses in 24 hours reached.`
    : s.now < nextOk
      ? `Too soon. Next dose allowed at ${clock(nextOk)}.`
      : null
  return { last, in24, nextOk, blockedReason }
}

export const canGiveMeds = (role: string) => role === 'RN' || role === 'EN'

const INJECTABLE = ['Subcutaneous', 'Intramuscular', 'Intravenous']
/** MOH LC §14: ENs may not prepare injectables or controlled drugs. */
export const rnOnly = (o: Order) => !!o.cd || INJECTABLE.includes(o.route)
export const isRn = (role: string) => role === 'RN' || role === 'NM'
export const awaitingVerification = (o: Order) => !!o.transcribed && !o.transcribed.verifiedBy
