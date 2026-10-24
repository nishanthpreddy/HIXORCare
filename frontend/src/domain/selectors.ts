import { band, currentSlot, dosesInSlot, findAdmin, fullName, isDueToday, residentOf, scoreTone, slotMin, windowMin, awaitingVerification } from './clinical'
import type { Snapshot } from './types'

export const latestVitals = (s: Snapshot, rid: string) =>
  s.vitals.filter((v) => v.rid === rid).sort((a, b) => b.t - a.t)[0]

export const vitalsOf = (s: Snapshot, rid: string) => s.vitals.filter((v) => v.rid === rid).sort((a, b) => a.t - b.t)

export const activeAlerts = (s: Snapshot, rid?: string) =>
  s.alerts.filter((a) => a.status !== 'resolved' && (rid === undefined || a.rid === rid))

export const latestAssessment = (s: Snapshot, rid: string, type: string) =>
  s.assessments.filter((a) => a.rid === rid && a.type === type).sort((a, b) => b.t - a.t)[0]

export const openTasks = (s: Snapshot, rid?: string) =>
  s.tasks.filter((t) => !t.done && (rid === undefined || t.rid === rid)).sort((a, b) => a.due - b.due)

export function shiftNow(now: number) {
  const m = ((now % 1440) + 1440) % 1440
  if (m >= 420 && m < 900) return { id: 'am', label: 'AM shift', start: 420, end: 900, next: 'PM' }
  if (m >= 900 && m < 1380) return { id: 'pm', label: 'PM shift', start: 900, end: 1380, next: 'Night' }
  return { id: 'night', label: 'Night shift', start: m >= 1380 ? 1380 : -60, end: m >= 1380 ? 1860 : 420, next: 'AM' }
}

export function roundProgress(s: Snapshot, slot: string) {
  let total = 0, given = 0, other = 0
  for (const o of dosesInSlot(s, slot)) {
    if (residentOf(s, o.rid)?.status !== 'in') continue
    total++
    const a = findAdmin(s, o.id, slot)
    if (a?.outcome === 'given') given++
    else if (a) other++
  }
  return { total, given, other, done: given + other }
}

export function residentSlot(s: Snapshot, rid: string, slot: string) {
  const orders = dosesInSlot(s, slot).filter((o) => o.rid === rid)
  const done = orders.filter((o) => findAdmin(s, o.id, slot)).length
  return { orders, done, total: orders.length }
}

export function nextDoses(s: Snapshot, rid: string) {
  const r = residentOf(s, rid)!
  if (r.status !== 'in') return null
  const slots = [...new Set(s.orders.filter((o) => o.rid === rid && !o.prn && isDueToday(o, s.day)).flatMap((o) => o.slots))].sort()
  for (const sl of slots) {
    const pending = s.orders.filter((o) => o.rid === rid && !o.prn && o.slots.includes(sl) && isDueToday(o, s.day) && !findAdmin(s, o.id, sl))
    if (pending.length) return { slot: sl, count: pending.length, overdue: s.now > slotMin(sl) + Math.min(...pending.map(windowMin)) }
  }
  return { slot: null, count: 0, overdue: false }
}

export type Tone = 'critical' | 'warning' | 'caution' | 'ok' | 'accent'

export interface NowItem {
  key: string
  rid: string | null
  tone: Tone
  title: string
  detail: string
  due?: number
  action: { label: string; to: 'round' | 'resident' | 'alerts'; tab?: string }
  rank: number
}

/** The "what needs doing now" queue on the ward board, most urgent first. */
export function nowQueue(s: Snapshot): NowItem[] {
  const items: NowItem[] = []
  const slot = currentSlot(s)
  for (const a of activeAlerts(s)) {
    if (a.kind === 'hospital') continue
    const r = a.rid ? residentOf(s, a.rid) : null
    const tone: Tone = a.severity === 'high' ? 'critical' : a.severity === 'medium' ? 'warning' : 'caution'
    items.push({
      key: a.id, rid: a.rid, tone, title: a.title, rank: a.severity === 'high' ? 0 : a.severity === 'medium' ? 2 : 4,
      detail: `${r ? `${fullName(r)} · ${r.bed} · ` : ''}${a.status === 'ack' ? 'Acknowledged' : 'Not yet acknowledged'}`,
      due: a.dueT,
      action: a.kind === 'transcription'
        ? { label: 'Verify', to: 'resident', tab: 'meds' }
        : a.kind === 'news2'
          ? { label: 'Record obs', to: 'resident', tab: 'vitals' }
          : a.kind === 'assessment'
            ? { label: 'Assess', to: 'resident', tab: 'assess' }
            : a.kind === 'skin'
              ? { label: 'Open wound', to: 'resident', tab: 'wounds' }
              : { label: 'Open', to: 'alerts' },
    })
  }
  // Time-critical doses not yet given.
  for (const o of dosesInSlot(s, slot)) {
    const r = residentOf(s, o.rid)!
    if (!o.timeCritical || r.status !== 'in' || findAdmin(s, o.id, slot)) continue
    const due = slotMin(slot)
    items.push({
      key: `tc-${o.id}`, rid: r.id, tone: s.now > due + 30 ? 'critical' : 'warning', rank: 1,
      title: `Time-critical: ${o.drug.split(' (')[0]} ${slot}`,
      detail: `${fullName(r)} · ${r.bed} · give within 30 minutes of ${slot}`,
      due: due + 30, action: { label: 'Give now', to: 'round' },
    })
  }
  for (const r of s.residents) {
    if (r.status !== 'in') continue
    const sw = s.orders.filter((o) => o.rid === r.id && awaitingVerification(o))
    if (sw.length && !activeAlerts(s, r.id).some((a) => a.kind === 'transcription')) {
      items.push({ key: `tr-${r.id}`, rid: r.id, tone: 'warning', rank: 2, title: 'Admission medicines to verify', detail: `${fullName(r)} · ${r.bed}`, action: { label: 'Verify', to: 'resident', tab: 'meds' } })
    }
  }
  // Care tasks due within the next 30 minutes or overdue.
  for (const t of openTasks(s)) {
    if (t.due > s.now + 30 || t.assessment) continue
    const r = residentOf(s, t.rid)!
    if (r.status !== 'in') continue
    items.push({
      key: t.id, rid: r.id, tone: t.due < s.now - 30 ? 'warning' : 'accent', rank: t.due < s.now ? 3 : 5,
      title: t.text, detail: `${fullName(r)} · ${r.bed}`, due: t.due,
      action: { label: t.category === 'obs' ? 'Record obs' : 'Open', to: 'resident', tab: t.category === 'obs' ? 'vitals' : 'care' },
    })
  }
  return items.sort((a, b) => a.rank - b.rank || (a.due ?? 1e9) - (b.due ?? 1e9))
}

export function riskChips(s: Snapshot, rid: string) {
  const chips: { label: string; tone: string; icon?: string }[] = []
  const morse = latestAssessment(s, rid, 'morse')
  if (morse && band('morse', morse.score).level === 'high') chips.push({ label: 'Falls risk', tone: 'warning', icon: 'walk' })
  const braden = latestAssessment(s, rid, 'braden')
  if (braden && band('braden', braden.score).level === 'high') chips.push({ label: 'Pressure risk', tone: 'warning', icon: 'layers' })
  return chips
}

export function news2Chip(s: Snapshot, rid: string) {
  const v = latestVitals(s, rid)
  if (!v) return null
  return { value: v.news2, tone: scoreTone(v.news2), t: v.t }
}
