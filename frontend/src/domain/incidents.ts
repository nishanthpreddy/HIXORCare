// Incident reporting and the post-fall pathway (MOH Licence Conditions §8 falls, §21 abuse; knowledge-base/domain/03 §6).
// The backend (backend/app/actions.py) applies the same rules.
import type { HarmLevel, Incident, IncidentType, Neuro, Resident, Snapshot } from './types'

export const INCIDENT_TYPES: { value: IncidentType; label: string; icon: string }[] = [
  { value: 'fall', label: 'Fall', icon: 'walk' },
  { value: 'medication', label: 'Medication error', icon: 'pill' },
  { value: 'skin', label: 'Skin tear or injury', icon: 'wound' },
  { value: 'behaviour', label: 'Aggression or behaviour', icon: 'flame' },
  { value: 'abuse', label: 'Abuse allegation', icon: 'shield' },
  { value: 'missing', label: 'Missing resident', icon: 'search' },
  { value: 'other', label: 'Something else', icon: 'note' },
]

export const HARM: { value: HarmLevel; label: string; hint: string; tone: string }[] = [
  { value: 5, label: 'Near miss', hint: 'Caught before it reached the resident', tone: 'ok' },
  { value: 4, label: 'No harm', hint: 'Reached the resident, no injury', tone: 'caution' },
  { value: 3, label: 'Minor harm', hint: 'First aid, a dressing or extra observation', tone: 'warning' },
  { value: 2, label: 'Moderate harm', hint: 'Doctor treatment or hospital transfer', tone: 'critical' },
  { value: 1, label: 'Severe harm or death', hint: 'Permanent harm, or death', tone: 'critical' },
]

export const FALL_FACTORS = [
  'Unwitnessed, at night', 'Getting up to the toilet', 'Footwear', 'Wet or cluttered floor', 'Bed or chair alarm off',
  'Walking aid not in reach', 'Confusion or delirium', 'Sedating or BP medicine', 'Low blood pressure', 'Infection or acute illness',
]

export const typeLabel = (t: IncidentType) => INCIDENT_TYPES.find((x) => x.value === t)?.label ?? t
export const harmOf = (h: HarmLevel) => HARM.find((x) => x.value === h)!
export const isSerious = (i: Incident) => i.harm <= 2

/** Blood thinners that make an unwitnessed fall a possible head injury. */
export const onBloodThinner = (s: Snapshot, rid: string) =>
  s.orders.some((o) => o.rid === rid && !o.stopped && !o.prn && o.classes.some((c) => c === 'anticoagulant' || c === 'antiplatelet'))

/** Neuro observations when the head may have been hit, nobody saw the fall, or the resident is on a blood thinner. */
export const needsNeuro = (f: { witnessed: boolean; headStrike: string; bloodThinner: boolean }) => f.headStrike !== 'no' || !f.witnessed || f.bloodThinner

/** Minutes after the fall: every 15 min for the first hour, then 2-hourly and 4-hourly to 24 hours. */
export const NEURO_SCHEDULE = [15, 30, 45, 60, 120, 240, 480, 720, 1440]
export const OBS_SCHEDULE = [60, 240, 1440]

/** A drop of two or more GCS points, unequal pupils or new limb weakness means call the doctor now. */
export function neuroChanged(n: Neuro, baseline?: Neuro) {
  return n.gcs <= 13 || (baseline !== undefined && baseline.gcs - n.gcs >= 2) || n.pupils !== 'equal and reactive' || n.limbs !== 'normal'
}

export function postFallTasks(i: Pick<Incident, 'fall' | 't'>) {
  const neuro = !!i.fall?.neuroObs
  const plan = neuro ? NEURO_SCHEDULE : OBS_SCHEDULE
  return plan.map((m, n) => ({ due: i.t + m, text: `Post-fall ${neuro ? 'neuro obs' : 'obs'} ${n + 1} of ${plan.length}` }))
}

/** What still stops a nurse manager from closing the incident. */
export function closeBlockers(s: Snapshot, i: Incident): string[] {
  const out: string[] = []
  if (i.harm <= 4 && !i.told.family) out.push('Record that the family has been told')
  if (i.harm <= 4 && !i.told.doctor) out.push('Record that the doctor has been told')
  if (!i.review) out.push(i.type === 'fall' ? 'Complete the post-fall analysis' : 'Record the review')
  if (i.type === 'fall') {
    if (!s.assessments.some((a) => a.rid === i.rid && a.type === 'morse' && a.t >= i.t)) out.push('Reassess falls risk (Morse)')
    const left = s.tasks.filter((t) => t.rid === i.rid && t.text.startsWith('Post-fall') && t.due >= i.t && !t.done).length
    if (left) out.push(`Finish post-fall observations (${left} left)`)
  }
  if (i.type === 'abuse') out.push('Abuse allegations are closed from a safeguarding case')
  return out
}

export function postFallProgress(s: Snapshot, i: Incident) {
  const tasks = s.tasks.filter((t) => t.rid === i.rid && t.text.startsWith('Post-fall') && t.due >= i.t && t.due <= i.t + 1440)
  return { done: tasks.filter((t) => t.done).length, total: tasks.length, next: tasks.filter((t) => !t.done).sort((a, b) => a.due - b.due)[0] }
}

export const openIncidents = (s: Snapshot, rid?: string) => s.incidents.filter((i) => i.status !== 'closed' && (!rid || i.rid === rid))

export function incidentTitle(i: Incident, r?: Resident) {
  return `${typeLabel(i.type)}${r ? `: ${r.salutation} ${r.name}` : ''}`
}
