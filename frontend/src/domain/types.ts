// Shapes shared by the API client, the in-browser demo backend and the views.
// Times (`t`) are minutes from 00:00 on the snapshot's `day` (Asia/Singapore).

export type Role = 'RN' | 'EN' | 'CA' | 'NM' | 'DR' | 'PH'

export interface Staff {
  id: string
  name: string
  short: string
  role: Role
  title: string
  shift: string | null
}

export interface Allergy {
  substance: string
  classes: string[]
  reaction: string
  severity: 'mild' | 'moderate' | 'severe'
  type: 'allergy' | 'intolerance'
}

export interface Resident {
  id: string
  bed: string
  salutation: string
  name: string
  preferred: string
  sex: 'M' | 'F'
  dob: string
  nric: string
  admitted: string
  languages: string[]
  religion: string
  diagnoses: string[]
  allergies: Allergy[]
  acp: { resus: string; note: string }
  decisionMaker: { name: string; relation: string; type: string; phone: string }
  diet: string
  swallow: string
  mobility: string
  continence: string
  status: 'in' | 'hospital' | 'leave'
  statusNote?: string
  flags: string[]
  /** Respite and other short stays: bed booked for a date range, planned discharge on `to`. */
  stay?: { type: 'respite'; from: string; to: string; note: string }
}

export interface MedCheck {
  field: 'sbp' | 'pulse' | 'cbg'
  label: string
  unit: string
  holdBelow?: number
  warnAbove?: number
}

export interface Order {
  id: string
  rid: string
  drug: string
  dose: string
  route: string
  slots: string[]
  indication?: string
  classes: string[]
  supply: 'blister' | 'pack'
  /** Resident's own medicines (respite): integrity checked on arrival, MOH LC section 14. */
  ownSupply?: string
  highAlert?: boolean
  cd?: boolean
  stockUnit?: string
  timeCritical?: boolean
  weekly?: number // day of week (0 = Sunday) for weekly medicines
  check?: MedCheck
  instructions?: string
  review?: string
  prn?: { reason: string; minHours: number; maxPer24h: number }
  /** Admission transcription (MOH LC §14): no dose until a different RN verifies. */
  transcribed?: { by: string; t: number; source: string; endorseDue: number; verifiedBy?: string; verifiedT?: number }
  /** Stopped by the doctor. A blister-pack medicine stays in the pack until the next 28-day cycle, so it is popped out and discarded at each round. */
  stopped?: { t: number; by: string; reason: string }
  prescriber: string
  start: string
}

export type Outcome = 'given' | 'held' | 'refused' | 'unavailable' | 'omitted' | 'discarded'

export interface Administration {
  id: string
  orderId: string
  rid: string
  slot: string
  day: number
  outcome: Outcome
  reason?: string
  note?: string
  values?: Record<string, number>
  witness?: string
  preparedBy?: string
  scan?: 'blister' | 'pack' | 'manual'
  t: number
  by: string
}

export interface PrnDose {
  id: string
  orderId: string
  t: number
  by: string
  witness?: string
  reason: string
  pain?: number
  effect?: { t: number; by: string; text: string; result: 'effective' | 'partial' | 'not effective' }
}

export interface Vitals {
  id: string
  rid: string
  t: number
  rr: number
  spo2: number
  o2: boolean
  sbp: number
  dbp: number
  pulse: number
  acvpu: 'A' | 'C' | 'V' | 'P' | 'U'
  temp: number
  by: string
  note?: string
  news2: number
}

export interface Glucose { id: string; rid: string; t: number; value: number; by: string; note?: string }

export type Severity = 'high' | 'medium' | 'low'

export interface Alert {
  id: string
  rid: string | null
  kind: string
  severity: Severity
  title: string
  detail: string
  t: number
  status: 'open' | 'ack' | 'resolved'
  ackBy?: string
  ackT?: number
  dueT?: number
  dueLabel?: string
  resolvedBy?: string
  resolvedT?: number
}

export interface Task {
  id: string
  rid: string
  text: string
  due: number
  repeat?: string
  category: string
  assessment?: string
  done?: { t: number; by: string; note?: string }
}

export interface Note { id: string; rid: string; t: number; by: string; kind: string; text: string }

export interface AssessmentRecord {
  id: string
  rid: string
  type: string
  score: number
  t: number
  by: string
  signedBy?: string
  answers?: Record<string, number>
}

export interface CareProblem { id: string; title: string; basis: string; goal: string; interventions: string[] }
export interface CarePlan {
  rid: string
  signedBy: string | null
  signedT: number | null
  reviewDue: string | null
  problems: CareProblem[]
}

export interface Suggestion {
  id: string
  rid: string
  source: string
  problem: string
  basis: string
  items: string[]
  t: number
  status: 'pending' | 'approved' | 'dismissed'
}

export interface WoundMeasure { t: number; length: number; width: number; depth: number; bed: string; exudate: string; by: string; photo?: string }
export interface Wound {
  id: string
  rid: string
  site: string
  type: string
  found: string
  dressing: string
  nextDressing: number
  measurements: WoundMeasure[]
}

export interface Handover { id: string; shift: string; t: number; from: string; to: string; summary: string }

export interface AuditEntry { seq: number; t: number; by: string; action: string; rid: string | null; detail: string; hash: string }

export interface IdCheck { rid: string; slot: string; t: number; by: string; method: 'wristband' | 'manual'; reason?: string }

export interface SbarMessage { id: string; rid: string; t: number; by: string; to: string; text: string }

/** Electronic controlled drug register: append-only, one running balance per drug. */
export interface CdEntry { seq: number; orderId: string; t: number; kind: 'opening' | 'received' | 'given' | 'returned' | 'correction'; change: number; balance: number; by: string; witness?: string; note: string }

export interface DecoyPack { barcode: string; label: string; drug: string; classes: string[]; owner: string | null; note: string }

export interface Snapshot {
  day: string // ISO date, e.g. 2026-10-24
  now: number
  home: { id: string; name: string; organisation: string }
  ward: { id: string; code: string; name: string; beds: number }
  staff: Staff[]
  residents: Resident[]
  orders: Order[]
  decoyPacks: DecoyPack[]
  cdStock: Record<string, { balance: number; unit: string }>
  cdLedger: CdEntry[]
  administrations: Administration[]
  idChecks: IdCheck[]
  prn: PrnDose[]
  vitals: Vitals[]
  glucose: Glucose[]
  alerts: Alert[]
  tasks: Task[]
  notes: Note[]
  assessments: AssessmentRecord[]
  carePlans: CarePlan[]
  suggestions: Suggestion[]
  wounds: Wound[]
  handovers: Handover[]
  sbar: SbarMessage[]
  audit: AuditEntry[]
}

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; code: 'blocked' | 'forbidden' | 'invalid' | 'pin'; message: string; detail?: string }
