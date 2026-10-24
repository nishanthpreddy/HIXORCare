// In-browser backend for demo mode. It mirrors the FastAPI actions in
// backend/app/actions.py so the app behaves the same with or without a server.
import seed from '../../../shared/seed.json'
import {
  ASSESSMENTS, ESCALATION, allergyClash, awaitingVerification, isRn, rnOnly, band, canGiveMeds, checkAdvice, findAdmin, fullName, needsWitness,
  news2, news2Risk, prnStatus, residentOf, verifyScan, type VitalsInput,
} from '../domain/clinical'
import type { ActionResult, Alert, Role, Snapshot, Staff, Task } from '../domain/types'

export const DEMO_PIN = '1234'

export interface EngineState {
  snap: Snapshot
  clockBase: number
  realAnchor: number
  seq: number
}

const todaySG = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

let idn = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(idn++).toString(36)}`

function fnv(str: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function initialState(): EngineState {
  const day = todaySG()
  const raw = structuredClone(seed) as unknown as Record<string, any>
  const vitals = raw.vitals.map((v: any, i: number) => ({ ...v, id: `v-${i}`, news2: news2(v) }))
  const cdStock: Snapshot['cdStock'] = {}
  for (const c of raw.cdStock) cdStock[c.orderId] = { balance: c.balance, unit: c.unit }
  const snap: Snapshot = {
    day,
    now: raw.clockStart,
    home: raw.home,
    ward: raw.ward,
    staff: raw.staff,
    residents: raw.residents,
    orders: raw.orders,
    decoyPacks: raw.decoyPacks,
    cdStock,
    cdLedger: raw.cdLedger,
    administrations: raw.administrations.map((a: any, i: number) => ({ ...a, id: `ad-${i}`, rid: raw.orders.find((o: any) => o.id === a.orderId).rid })),
    idChecks: [],
    prn: raw.prn,
    vitals,
    glucose: raw.glucose.map((g: any, i: number) => ({ ...g, id: `g-${i}` })),
    alerts: raw.alerts,
    tasks: raw.tasks,
    notes: raw.notes,
    assessments: raw.assessments,
    carePlans: raw.carePlans,
    suggestions: [],
    wounds: raw.wounds,
    handovers: raw.handovers,
    sbar: [],
    audit: [],
  }
  const st: EngineState = { snap, clockBase: raw.clockStart, realAnchor: Date.now(), seq: 0 }
  for (const a of raw.audit) appendAudit(st, a.by, a.action, a.rid, a.detail, a.t)
  return st
}

export function tick(st: EngineState) {
  st.snap.now = st.clockBase + Math.floor((Date.now() - st.realAnchor) / 60000)
}

function appendAudit(st: EngineState, by: string, action: string, rid: string | null, detail: string, t = st.snap.now) {
  const prev = st.snap.audit[0]?.hash ?? '00000000'
  const seq = ++st.seq
  const hash = fnv(prev + JSON.stringify({ seq, t, by, action, rid, detail }))
  st.snap.audit.unshift({ seq, t, by, action, rid, detail, hash })
}

type Body = Record<string, any>
type Handler = (st: EngineState, me: Staff, b: Body) => ActionResult<any>

const fail = (code: 'blocked' | 'forbidden' | 'invalid' | 'pin', message: string, detail?: string): ActionResult => ({ ok: false, code, message, detail })

function staff(st: EngineState, id: string) {
  return st.snap.staff.find((s) => s.id === id)
}

function checkPin(st: EngineState, staffId: string, pin: string | undefined) {
  return !!staff(st, staffId) && pin === DEMO_PIN
}

function raise(st: EngineState, a: Omit<Alert, 'id' | 't' | 'status'>) {
  const alert: Alert = { ...a, id: uid('a'), t: st.snap.now, status: 'open' }
  st.snap.alerts.unshift(alert)
  return alert
}

function cdTake(st: EngineState, orderId: string, used: number, by: string, witness: string, note: string) {
  const c = st.snap.cdStock[orderId]
  const before = c.balance
  c.balance = Math.round((c.balance - used) * 100) / 100
  st.snap.cdLedger.push({ seq: st.snap.cdLedger.length + 1, orderId, t: st.snap.now, kind: 'given', change: -used, balance: c.balance, by, witness, note })
  return ` CD register: ${before} → ${c.balance} ${c.unit}.`
}

/** Stock units one dose uses: 1 tablet, or the mL in brackets for liquids ("2.5 mg (1.25 mL)"). */
function cdUnits(o: { dose: string; stockUnit?: string }) {
  if (o.stockUnit !== 'mL') return 1
  return parseFloat(o.dose.match(/\(([\d.]+) mL\)/)?.[1] ?? '1')
}

const ACTIONS: Record<string, { roles: Role[] | 'any'; run: Handler }> = {
  'auth.check': {
    roles: 'any',
    run: (st, _me, b) => (checkPin(st, b.staffId, b.pin) ? { ok: true } : fail('pin', 'That PIN is not right. Try again.')),
  },

  'identity.confirm': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const r = residentOf(st.snap, b.rid)
      if (!r) return fail('invalid', 'Resident not found.')
      if (b.method === 'wristband' && b.barcode && b.barcode !== `WB-${r.id.slice(2).toUpperCase()}`) {
        const other = st.snap.residents.find((x) => b.barcode === `WB-${x.id.slice(2).toUpperCase()}`)
        appendAudit(st, me.id, 'Identity mismatch', r.id, `Scanned wristband of ${other ? fullName(other) : 'unknown person'} while giving ${fullName(r)}'s medicines.`)
        return fail('blocked', 'Wrong wristband', other ? `This wristband belongs to ${fullName(other)} (${other.bed}). Find ${r.preferred} and scan again.` : 'Wristband not recognised.')
      }
      if (b.method === 'manual' && !b.reason) return fail('invalid', 'Give a reason for confirming identity without the wristband.')
      st.snap.idChecks = st.snap.idChecks.filter((c) => !(c.rid === r.id && c.slot === b.slot))
      st.snap.idChecks.push({ rid: r.id, slot: b.slot, t: st.snap.now, by: me.id, method: b.method, reason: b.reason })
      appendAudit(st, me.id, 'Identity confirmed', r.id, b.method === 'wristband' ? `Wristband scanned for the ${b.slot} round.` : `Confirmed by photo and two identifiers for the ${b.slot} round. Reason: ${b.reason}.`)
      return { ok: true }
    },
  },

  'scan.verify': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const res = verifyScan(st.snap, b.rid, b.slot, b.barcode, st.snap.decoyPacks)
      const r = residentOf(st.snap, b.rid)!
      if (!res.ok) {
        appendAudit(st, me.id, res.kind === 'allergy' ? 'Allergy block' : 'Scan blocked', r.id, `${res.title} ${res.detail}`)
        if (res.kind === 'allergy' || res.kind === 'wrong-resident') {
          raise(st, { rid: r.id, kind: 'near-miss', severity: 'medium', title: res.kind === 'allergy' ? 'Near miss: allergy block' : 'Near miss: wrong resident', detail: `${res.title} Stopped at the bedside by ${me.name}. Review for the medication safety log.` })
        }
      } else {
        appendAudit(st, me.id, 'Pack scanned', r.id, `${res.title}: ${res.detail}`)
      }
      return { ok: true, data: res }
    },
  },

  'dose.record': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const s = st.snap
      const o = s.orders.find((x) => x.id === b.orderId)
      if (!o) return fail('invalid', 'Medicine order not found.')
      const r = residentOf(s, o.rid)!
      if (r.status !== 'in') return fail('blocked', `${r.preferred} is away from the home`, r.statusNote)
      if (findAdmin(s, o.id, b.slot)) return fail('invalid', 'This dose is already recorded.')
      const outcome = b.outcome as string
      if (outcome === 'given') {
        if (awaitingVerification(o)) return fail('blocked', 'Waiting for RN verification', `${o.drug} was transcribed on admission and must be verified by a different RN before the first dose.`)
        if (rnOnly(o) && !isRn(me.role)) return fail('forbidden', 'A registered nurse must give this', `${o.cd ? 'Controlled drugs' : 'Injectables'} are prepared and given by an RN. You can act as the second checker.`)
        if (!s.idChecks.some((c) => c.rid === r.id && c.slot === b.slot)) return fail('blocked', 'Confirm identity first', 'Scan the wristband before giving medicines.')
        if (!b.scan) return fail('blocked', 'Scan the medicine first', 'Scan the sachet or pack so the system can check it.')
        const clash = allergyClash(r.allergies, o.classes)
        if (clash) return fail('blocked', `Allergy: ${clash.substance}`, `${r.preferred} has a recorded ${clash.type} to ${clash.substance} (${clash.reaction}). Contact the doctor.`)
        if (o.check) {
          const v = Number(b.values?.[o.check.field])
          if (b.values?.[o.check.field] === undefined || Number.isNaN(v)) return fail('invalid', `Enter ${o.check.label.toLowerCase()} first.`)
          const adv = checkAdvice(o, v)
          if (adv?.tone === 'critical') return fail('blocked', 'Hold this dose', adv.text)
        }
        if (needsWitness(o)) {
          const w = staff(st, b.witnessId)
          if (!w) return fail('invalid', 'Choose the second nurse.')
          if (w.id === me.id) return fail('invalid', 'The second check must be done by another nurse.')
          if (!canGiveMeds(w.role)) return fail('forbidden', `${w.short} cannot act as second checker`, 'Second checks need a registered or enrolled nurse.')
          if (!checkPin(st, w.id, b.witnessPin)) return fail('pin', `${w.short}'s PIN is not right.`)
        }
      } else if (!b.reason) {
        return fail('invalid', 'Choose a reason.')
      }
      let stockNote = ''
      if (outcome === 'given' && o.cd) stockNote = cdTake(st, o.id, cdUnits(o), me.id, b.witnessId, `${b.slot} dose for ${fullName(r)}`)
      s.administrations.push({
        id: uid('ad'), orderId: o.id, rid: r.id, slot: b.slot, day: 0, outcome: outcome as any, reason: b.reason, note: b.note,
        values: b.values, witness: b.witnessId, preparedBy: outcome === 'given' ? me.id : undefined, scan: b.scan, t: s.now, by: me.id,
      })
      if (o.check?.field === 'cbg' && b.values?.cbg !== undefined) {
        s.glucose.push({ id: uid('g'), rid: r.id, t: s.now, value: Number(b.values.cbg), by: me.id, note: `Before ${o.drug.split(' ')[0].toLowerCase()}` })
      }
      const w = b.witnessId ? staff(st, b.witnessId) : null
      const verb = { given: 'Dose given', held: 'Dose held', refused: 'Dose refused', unavailable: 'Dose not available', omitted: 'Dose omitted' }[outcome] ?? 'Dose recorded'
      appendAudit(st, me.id, verb, r.id, `${o.drug} ${o.dose}, ${b.slot} dose.${b.reason ? ` Reason: ${b.reason}.` : ''}${w ? ` Second check: ${w.name} (${w.role}).` : ''}${b.values ? ` ${Object.entries(b.values).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}.` : ''}${stockNote}`)
      if (outcome !== 'given' && (o.timeCritical || o.highAlert || outcome === 'unavailable' || outcome === 'refused')) {
        raise(st, {
          rid: r.id, kind: outcome === 'refused' ? 'refused' : 'missed-dose', severity: o.timeCritical || o.highAlert ? 'high' : 'low',
          title: `${o.drug.split(' (')[0]} ${outcome === 'held' ? 'held' : outcome === 'refused' ? 'refused' : 'not given'}`,
          detail: `${b.slot} dose. ${b.reason}.${o.timeCritical ? ' Time-critical medicine: inform the doctor.' : ''}${b.note ? ` ${b.note}` : ''}`,
        })
      }
      return { ok: true, message: stockNote.trim() || undefined }
    },
  },

  'order.verify': {
    roles: ['RN', 'NM'],
    run: (st, me, b) => {
      const s = st.snap
      const orders = s.orders.filter((o) => o.rid === b.rid && awaitingVerification(o))
      if (!orders.length) return fail('invalid', 'Nothing is waiting for verification.')
      if (orders.some((o) => o.transcribed!.by === me.id)) return fail('blocked', 'A different RN must verify', 'You transcribed these medicines, so another RN has to check them.')
      if (!checkPin(st, me.id, b.pin)) return fail('pin', 'That PIN is not right.')
      for (const o of orders) { o.transcribed!.verifiedBy = me.id; o.transcribed!.verifiedT = s.now }
      for (const a of s.alerts) if (a.rid === b.rid && a.kind === 'transcription' && a.status !== 'resolved') { a.status = 'resolved'; a.resolvedBy = me.id; a.resolvedT = s.now }
      appendAudit(st, me.id, 'Transcription verified', b.rid, `${orders.length} admission medicines checked against ${orders[0].transcribed!.source}: ${orders.map((o) => o.drug).join(', ')}. Doctor endorsement still due.`)
      return { ok: true }
    },
  },

  'prn.give': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const s = st.snap
      const o = s.orders.find((x) => x.id === b.orderId && x.prn)
      if (!o) return fail('invalid', 'PRN order not found.')
      const r = residentOf(s, o.rid)!
      const ps = prnStatus(s, o)
      if (ps.blockedReason) return fail('blocked', 'Not allowed yet', ps.blockedReason)
      if (rnOnly(o) && !isRn(me.role)) return fail('forbidden', 'A registered nurse must give this', 'Controlled drugs and injectables are prepared and given by an RN.')
      if (!b.reason) return fail('invalid', 'Give the reason for this dose.')
      if (needsWitness(o)) {
        const w = staff(st, b.witnessId)
        if (!w || w.id === me.id || !canGiveMeds(w.role)) return fail('invalid', 'Choose another nurse as second checker.')
        if (!checkPin(st, w.id, b.witnessPin)) return fail('pin', `${w.short}'s PIN is not right.`)
      }
      let stockNote = ''
      if (o.cd) stockNote = cdTake(st, o.id, cdUnits(o), me.id, b.witnessId, `PRN for ${fullName(r)}: ${b.reason}`)
      const id = uid('p')
      s.prn.push({ id, orderId: o.id, t: s.now, by: me.id, witness: b.witnessId, reason: b.reason, pain: b.pain })
      s.tasks.push({ id: uid('t'), rid: r.id, text: `Check effect of ${o.drug.split(' ')[0].toLowerCase()} (PRN)`, due: s.now + 60, category: 'medication' })
      appendAudit(st, me.id, 'PRN given', r.id, `${o.drug} ${o.dose}. Reason: ${b.reason}${b.pain !== undefined ? `, pain ${b.pain}/10` : ''}.${stockNote}`)
      return { ok: true, data: { id }, message: 'Effect check added for 1 hour from now.' }
    },
  },

  'prn.effect': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const p = st.snap.prn.find((x) => x.id === b.prnId)
      if (!p) return fail('invalid', 'PRN dose not found.')
      p.effect = { t: st.snap.now, by: me.id, text: b.text || '', result: b.result }
      const o = st.snap.orders.find((x) => x.id === p.orderId)!
      const task = st.snap.tasks.find((t) => !t.done && t.rid === o.rid && t.text.startsWith('Check effect of'))
      if (task) task.done = { t: st.snap.now, by: me.id }
      appendAudit(st, me.id, 'PRN effect recorded', o.rid, `${o.drug}: ${b.result}. ${b.text || ''}`.trim())
      return { ok: true }
    },
  },

  'vitals.record': {
    roles: ['RN', 'EN', 'CA'],
    run: (st, me, b) => {
      const s = st.snap
      const r = residentOf(s, b.rid)
      if (!r) return fail('invalid', 'Resident not found.')
      const v: VitalsInput = { rr: +b.rr, spo2: +b.spo2, o2: !!b.o2, sbp: +b.sbp, pulse: +b.pulse, acvpu: b.acvpu, temp: +b.temp }
      if (Object.values(v).some((x) => typeof x === 'number' && Number.isNaN(x))) return fail('invalid', 'Fill in every reading.')
      const score = news2(v)
      const risk = news2Risk(v)
      s.vitals.push({ ...v, id: uid('v'), rid: r.id, dbp: +b.dbp, t: s.now, by: me.id, note: b.note, news2: score })
      const pol = ESCALATION[risk]
      let alertId: string | undefined
      for (const a of s.alerts) if (a.rid === r.id && a.kind === 'news2' && a.status !== 'resolved') { a.status = 'resolved'; a.resolvedBy = me.id; a.resolvedT = s.now }
      if (pol.alert) {
        const al = raise(st, {
          rid: r.id, kind: 'news2', severity: risk === 'high' ? 'high' : risk === 'medium' ? 'high' : 'medium',
          title: `NEWS2 ${score}: ${risk === 'high' ? 'emergency response' : risk === 'medium' ? 'urgent review' : 'single red score'}`,
          detail: `Temp ${v.temp} °C, RR ${v.rr}, SpO₂ ${v.spo2}%${v.o2 ? ' on oxygen' : ''}, pulse ${v.pulse}, BP ${v.sbp}/${b.dbp}, ${v.acvpu === 'A' ? 'alert' : `ACVPU ${v.acvpu}`}. ${pol.action}`,
          dueT: s.now + pol.obsEveryMin, dueLabel: 'Next observations',
        })
        alertId = al.id
      }
      const obsTask = s.tasks.find((t) => !t.done && t.rid === r.id && t.category === 'obs' && t.due <= s.now + 60 && !t.text.toLowerCase().includes('glucose'))
      if (obsTask) obsTask.done = { t: s.now, by: me.id }
      if (pol.obsEveryMin <= 60) s.tasks.push({ id: uid('t'), rid: r.id, text: `Observations (NEWS2 ${score})`, due: s.now + pol.obsEveryMin, category: 'obs' })
      appendAudit(st, me.id, 'Observations recorded', r.id, `NEWS2 ${score} (${pol.label.toLowerCase()} risk).${pol.alert ? ' Alert raised to nurse in charge.' : ''}`)
      return { ok: true, data: { score, risk, alertId } }
    },
  },

  'alert.ack': {
    roles: ['RN', 'EN', 'NM'],
    run: (st, me, b) => {
      const a = st.snap.alerts.find((x) => x.id === b.id)
      if (!a) return fail('invalid', 'Alert not found.')
      a.status = 'ack'; a.ackBy = me.id; a.ackT = st.snap.now
      appendAudit(st, me.id, 'Alert acknowledged', a.rid, a.title)
      return { ok: true }
    },
  },

  'alert.resolve': {
    roles: ['RN', 'NM'],
    run: (st, me, b) => {
      const a = st.snap.alerts.find((x) => x.id === b.id)
      if (!a) return fail('invalid', 'Alert not found.')
      a.status = 'resolved'; a.resolvedBy = me.id; a.resolvedT = st.snap.now
      appendAudit(st, me.id, 'Alert closed', a.rid, `${a.title}.${b.note ? ` ${b.note}` : ''}`)
      return { ok: true }
    },
  },

  'sbar.send': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      if (!b.text?.trim()) return fail('invalid', 'The message is empty.')
      if (!b.reviewed) return fail('invalid', 'Confirm that you have checked the draft.')
      st.snap.sbar.unshift({ id: uid('sb'), rid: b.rid, t: st.snap.now, by: me.id, to: b.to, text: b.text })
      st.snap.notes.push({ id: uid('n'), rid: b.rid, t: st.snap.now, by: me.id, kind: 'SBAR to doctor', text: b.text })
      appendAudit(st, me.id, 'SBAR sent', b.rid, `To ${staff(st, b.to)?.name ?? 'doctor'}. Drafted by assistant, checked and signed by ${me.name}.`)
      return { ok: true }
    },
  },

  'task.complete': {
    roles: ['RN', 'EN', 'CA'],
    run: (st, me, b) => {
      const t = st.snap.tasks.find((x) => x.id === b.id)
      if (!t) return fail('invalid', 'Task not found.')
      if (t.done) return fail('invalid', 'Already done.')
      t.done = { t: st.snap.now, by: me.id, note: b.note }
      const step = t.repeat === 'hourly' ? 60 : t.repeat === '2-hourly' ? 120 : t.repeat === '30 min' ? 30 : 0
      if (step) {
        const next: Task = { ...t, id: uid('t'), due: Math.max(t.due, st.snap.now) + step, done: undefined }
        if (t.category === 'skin' && t.text.startsWith('Reposition')) next.text = t.text.includes('left') ? 'Reposition (right side)' : 'Reposition (left side)'
        st.snap.tasks.push(next)
      }
      appendAudit(st, me.id, 'Care task done', t.rid, `${t.text}.${b.note ? ` ${b.note}` : ''}`)
      return { ok: true }
    },
  },

  'note.add': {
    roles: ['RN', 'EN', 'CA', 'NM', 'DR'],
    run: (st, me, b) => {
      if (!b.text?.trim()) return fail('invalid', 'Write the note first.')
      st.snap.notes.push({ id: uid('n'), rid: b.rid, t: st.snap.now, by: me.id, kind: b.kind || 'Nursing', text: b.text.trim() })
      appendAudit(st, me.id, 'Note added', b.rid, `${b.kind || 'Nursing'} note.`)
      return { ok: true }
    },
  },

  'assessment.submit': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const def = ASSESSMENTS[b.type]
      if (!def) return fail('invalid', 'Unknown assessment.')
      const answers = b.answers as Record<string, number>
      if (def.items.some((i) => answers?.[i.id] === undefined)) return fail('invalid', 'Answer every question.')
      if (!checkPin(st, me.id, b.pin)) return fail('pin', 'That PIN is not right.')
      const score = def.items.reduce((sum, i) => sum + i.options[answers[i.id]].score, 0)
      const bd = band(b.type, score)
      const s = st.snap
      const rec = { id: uid('as'), rid: b.rid, type: b.type, score, t: s.now, by: me.id, signedBy: me.role === 'RN' ? me.id : undefined, answers }
      s.assessments.push(rec)
      const task = s.tasks.find((t) => !t.done && t.rid === b.rid && t.assessment === b.type)
      if (task) task.done = { t: s.now, by: me.id }
      const items = def.suggest[bd.level]
      let suggestionId: string | undefined
      if (items?.length) {
        const existing = s.carePlans.find((c) => c.rid === b.rid)?.problems.flatMap((p) => p.interventions.map((x) => x.toLowerCase())) ?? []
        const fresh = items.filter((x) => !existing.includes(x.toLowerCase()))
        if (fresh.length) {
          suggestionId = uid('sg')
          s.suggestions.unshift({ id: suggestionId, rid: b.rid, source: def.name, problem: `${bd.label}: ${def.short.toLowerCase()}`, basis: `${def.name} ${score} on ${new Date(s.day).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`, items: fresh, t: s.now, status: 'pending' })
        }
      }
      const open = s.tasks.filter((t) => !t.done && t.rid === b.rid && t.assessment)
      if (!open.length) for (const a of s.alerts) if (a.rid === b.rid && a.kind === 'assessment' && a.status !== 'resolved') { a.status = 'resolved'; a.resolvedBy = me.id; a.resolvedT = s.now }
      appendAudit(st, me.id, 'Assessment signed', b.rid, `${def.name}: ${score} (${bd.label}).${suggestionId ? ' Care plan suggestions created.' : ''}`)
      return { ok: true, data: { score, band: bd, suggestionId } }
    },
  },

  'careplan.approve': {
    roles: ['RN', 'NM'],
    run: (st, me, b) => {
      const s = st.snap
      const sg = s.suggestions.find((x) => x.id === b.suggestionId)
      if (!sg) return fail('invalid', 'Suggestion not found.')
      if (!checkPin(st, me.id, b.pin)) return fail('pin', 'That PIN is not right.')
      const items: string[] = b.items ?? []
      if (!items.length) return fail('invalid', 'Keep at least one item, or dismiss the suggestion.')
      let plan = s.carePlans.find((c) => c.rid === sg.rid)
      if (!plan) { plan = { rid: sg.rid, signedBy: null, signedT: null, reviewDue: null, problems: [] }; s.carePlans.push(plan) }
      plan.problems.push({ id: uid('cp'), title: sg.problem.replace(/^./, (c) => c.toUpperCase()), basis: sg.basis, goal: 'Agreed with resident and family at next review', interventions: items })
      plan.signedBy = me.id; plan.signedT = s.now
      const review = new Date(s.day); review.setDate(review.getDate() + 30); plan.reviewDue = review.toISOString().slice(0, 10)
      sg.status = 'approved'
      for (const it of items) {
        const low = it.toLowerCase()
        if (low.includes('hourly') || low.includes('reposition') || low.includes('chart') || low.includes('check')) {
          s.tasks.push({ id: uid('t'), rid: sg.rid, text: it, due: s.now + 60, category: 'care plan' })
        }
      }
      appendAudit(st, me.id, 'Care plan signed', sg.rid, `Added "${sg.problem}" with ${items.length} interventions${sg.items.length > items.length ? ` (${sg.items.length - items.length} suggestions removed)` : ''}.`)
      return { ok: true }
    },
  },

  'suggestion.dismiss': {
    roles: ['RN', 'NM'],
    run: (st, me, b) => {
      const sg = st.snap.suggestions.find((x) => x.id === b.suggestionId)
      if (!sg) return fail('invalid', 'Suggestion not found.')
      sg.status = 'dismissed'
      appendAudit(st, me.id, 'Suggestion dismissed', sg.rid, sg.problem)
      return { ok: true }
    },
  },

  'wound.measure': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const w = st.snap.wounds.find((x) => x.id === b.woundId)
      if (!w) return fail('invalid', 'Wound not found.')
      if (!(b.length > 0) || !(b.width > 0)) return fail('invalid', 'Enter length and width in cm.')
      w.measurements.push({ t: st.snap.now, length: +b.length, width: +b.width, depth: +b.depth || 0, bed: b.bed, exudate: b.exudate, by: me.id, photo: b.photo })
      if (b.dressed) {
        const days = /every (\d+) days/.exec(w.dressing)?.[1]
        w.nextDressing = st.snap.now + (days ? +days : 3) * 1440
        const task = st.snap.tasks.find((t) => !t.done && t.rid === w.rid && t.text.toLowerCase().includes('dressing'))
        if (task) task.done = { t: st.snap.now, by: me.id }
        for (const a of st.snap.alerts) if (a.rid === w.rid && a.kind === 'skin' && a.status !== 'resolved') { a.status = 'resolved'; a.resolvedBy = me.id; a.resolvedT = st.snap.now }
      }
      appendAudit(st, me.id, 'Wound measured', w.rid, `${w.site}: ${b.length} × ${b.width} cm.${b.dressed ? ' Dressing changed.' : ''}${b.photo ? ' Photo added.' : ''}`)
      return { ok: true }
    },
  },

  'handover.sign': {
    roles: ['RN', 'EN'],
    run: (st, me, b) => {
      const to = staff(st, b.toId)
      if (!to || to.id === me.id) return fail('invalid', 'Choose the nurse taking over.')
      if (!canGiveMeds(to.role)) return fail('forbidden', 'Handover must go to a nurse.')
      if (!checkPin(st, to.id, b.pin)) return fail('pin', `${to.short}'s PIN is not right.`)
      st.snap.handovers.unshift({ id: uid('h'), shift: b.shift, t: st.snap.now, from: me.id, to: to.id, summary: b.summary || '' })
      appendAudit(st, me.id, 'Handover signed', null, `${b.shiftLabel ?? 'Shift'} handover. Received by ${to.name} (${to.role}).`)
      return { ok: true }
    },
  },
}

export function runAction(st: EngineState, actorId: string, action: string, body: Body): ActionResult<any> {
  tick(st)
  const me = staff(st, actorId)
  if (!me) return fail('forbidden', 'Sign in first.')
  if (action === 'demo.advance') {
    st.clockBase += Number(body.minutes) || 0
    tick(st)
    return { ok: true }
  }
  const def = ACTIONS[action]
  if (!def) return fail('invalid', `Unknown action ${action}.`)
  if (def.roles !== 'any' && !def.roles.includes(me.role)) {
    return fail('forbidden', 'Not allowed for your role', `${me.title}s cannot do this. Ask a nurse.`)
  }
  return def.run(st, me, body)
}
