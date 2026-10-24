import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Banner, Chip, PinPad, Ring, Sheet } from '../ui/kit'
import {
  age, awaitingVerification, checkAdvice, clock, currentSlot, doseState, findAdmin, fullName, isRn, needsWitness, packBarcode,
  prnStatus, residentOf, rnOnly, roundsToday, blisterBarcode, slotMin, stoppedInBlister, until, when, canGiveMeds, type ScanResult,
} from '../domain/clinical'
import { residentSlot, roundProgress } from '../domain/selectors'
import type { Order, Resident } from '../domain/types'

export function Round() {
  const { s, me, route } = useApp()
  const slots = roundsToday(s)
  const [slot, setSlot] = useState(() => currentSlot(s))
  const rows = useMemo(() => s.residents.filter((r) => residentSlot(s, r.id, slot).total > 0), [s, slot])
  const [sel, setSel] = useState<string | null>(() => (route.rid && rows.some((r) => r.id === route.rid) ? route.rid : null))
  const [cdOpen, setCdOpen] = useState(false)
  const wide = typeof window !== 'undefined' && window.innerWidth > 860

  useEffect(() => {
    if (!sel && wide) {
      const first = rows.find((r) => r.status === 'in' && residentSlot(s, r.id, slot).done < residentSlot(s, r.id, slot).total)
      setSel(first?.id ?? rows[0]?.id ?? null)
    }
  }, [sel, rows, s, slot, wide])

  const prog = roundProgress(s, slot)
  const nextOf = (rid: string) => {
    const i = rows.findIndex((r) => r.id === rid)
    return rows.slice(i + 1).find((r) => r.status === 'in' && residentSlot(s, r.id, slot).done < residentSlot(s, r.id, slot).total) ?? null
  }

  if (me && !canGiveMeds(me.role) && !isRn(me.role)) {
    return (
      <div className="admin"><div className="admin-inner">
        <Banner tone="info" icon="lock" title="Medication rounds are for nurses">
          {me.title}s cannot give or record medicines. You can still see who is due on the Today page and record observations.
        </Banner>
      </div></div>
    )
  }

  return (
    <div className={`round${sel ? ' has-sel' : ''}`}>
      <aside className="round-list" aria-label="Residents in this round">
        <div className="round-list-h">
          <div className="row">
            <div className="grow">
              <div className="eyebrow">Round</div>
              <div className="strong num" style={{ fontSize: 18 }}>{prog.done} of {prog.total} doses</div>
            </div>
            <button className="btn sm soft" onClick={() => setCdOpen(true)}><Icon name="vial" />CD register</button>
          </div>
          <div className="slot-scroller" role="group" aria-label="Choose round">
            {slots.map((sl) => {
              const p = roundProgress(s, sl)
              const due = slotMin(sl)
              const label = p.total && p.done === p.total ? 'Done' : s.now > due + 60 ? 'Overdue' : s.now >= due - 60 ? 'Due now' : until(due - 60, s.now).replace('in ', 'in ')
              return (
                <button key={sl} className={`slot-btn${p.total && p.done === p.total ? ' done' : ''}`} aria-pressed={sl === slot} onClick={() => { setSlot(sl); setSel(null) }}>
                  <b>{sl}</b>
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
          <div className="progress"><i style={{ width: `${(prog.given / Math.max(prog.total, 1)) * 100}%` }} /><i className="held" style={{ width: `${(prog.other / Math.max(prog.total, 1)) * 100}%` }} /></div>
        </div>
        <div className="round-rows">
          {rows.map((r) => {
            const rs = residentSlot(s, r.id, slot)
            const away = r.status !== 'in'
            const flags = rs.orders
            return (
              <button key={r.id} className="rr" aria-current={sel === r.id} onClick={() => setSel(r.id)}>
                <Avatar id={r.id} name={r.name} size={42} dim={away} />
                <div className="grow">
                  <div className="nm">{r.salutation} {r.name}</div>
                  <div className="sub">
                    <span className="strong">{r.bed}</span>
                    {away ? <span>In hospital</span> : <span>{rs.total} medicine{rs.total > 1 ? 's' : ''}</span>}
                    <span className="mini-flags">
                      {r.allergies.some((a) => a.type === 'allergy') && <i className="tone-critical" title="Allergy">A</i>}
                      {flags.some((o) => o.timeCritical) && <i className="tone-warning" title="Time-critical">T</i>}
                      {flags.some((o) => o.highAlert) && <i className="tone-hi" title="High-alert medicine">H</i>}
                      {flags.some((o) => o.cd) && <i className="tone-hi" title="Controlled drug">CD</i>}
                      {flags.some((o) => awaitingVerification(o)) && <i className="tone-caution" title="Needs verification">V</i>}
                    </span>
                  </div>
                </div>
                {away ? <Chip>Away</Chip> : <Ring done={rs.done} total={rs.total} />}
              </button>
            )
          })}
        </div>
      </aside>
      <section className="admin" aria-label="Give medicines">
        {sel ? (
          <AdminPanel key={`${sel}-${slot}`} rid={sel} slot={slot} onBack={() => setSel(null)} next={nextOf(sel)} onNext={(id) => setSel(id)} />
        ) : (
          <div className="empty">Choose a resident to start.</div>
        )}
      </section>
      {cdOpen && <CdRegister onClose={() => setCdOpen(false)} />}
    </div>
  )
}

type SheetState =
  | { kind: 'wristband' }
  | { kind: 'manual-id' }
  | { kind: 'scan'; orderIds: string[] }
  | { kind: 'witness'; order: Order }
  | { kind: 'notgiven'; order: Order }
  | { kind: 'prn'; order: Order }
  | { kind: 'effect'; prnId: string; order: Order }
  | { kind: 'verify' }
  | null

function AdminPanel({ rid, slot, onBack, next, onNext }: { rid: string; slot: string; onBack: () => void; next: Resident | null; onNext: (id: string) => void }) {
  const { s, me, act, toast, staff } = useApp()
  const r = residentOf(s, rid)!
  const rs = residentSlot(s, rid, slot)
  const idCheck = s.idChecks.find((c) => c.rid === rid && c.slot === slot)
  const [scanned, setScanned] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [sheet, setSheet] = useState<SheetState>(null)
  const [tab, setTab] = useState<'due' | 'prn'>('due')
  const prnOrders = s.orders.filter((o) => o.rid === rid && o.prn)
  const blister = rs.orders.filter((o) => o.supply === 'blister')
  const stopped = stoppedInBlister(s, rid, slot)
  const stoppedPending = stopped.filter((o) => !findAdmin(s, o.id, slot))
  const packs = rs.orders.filter((o) => o.supply === 'pack')
  const allDone = rs.done === rs.total
  const away = r.status !== 'in'
  const pendingVerify = rs.orders.some(awaitingVerification)
  const pendingEffects = s.prn.filter((p) => !p.effect && prnOrders.some((o) => o.id === p.orderId))

  const give = async (o: Order, witness?: { id: string; pin: string }) => {
    const v = o.check ? { [o.check.field]: Number(values[o.id]) } : undefined
    const res = await act('dose.record', {
      orderId: o.id, slot, outcome: 'given', scan: o.supply, values: v, witnessId: witness?.id, witnessPin: witness?.pin,
    }, witness ? { quiet: true } : { success: `${o.drug.split(' (')[0]} given.` })
    return res
  }

  const giveAllBlister = async () => {
    for (const o of blister) {
      if (findAdmin(s, o.id, slot) || !scanned.has(o.id) || needsWitness(o) || (o.check && !values[o.id])) continue
      const v = o.check ? { [o.check.field]: Number(values[o.id]) } : undefined
      const res = await act('dose.record', { orderId: o.id, slot, outcome: 'given', scan: 'blister', values: v }, { quiet: true })
      if (!res.ok) { toast(`${o.drug}: ${res.message}`, 'critical'); return }
    }
    toast('Blister pack medicines given.')
  }

  const readyForAll = stoppedPending.length === 0 && blister.filter((o) => !findAdmin(s, o.id, slot)).every((o) => scanned.has(o.id) && (!o.check || (values[o.id] && checkAdvice(o, Number(values[o.id]))?.tone !== 'critical')))
  const blisterPending = blister.filter((o) => !findAdmin(s, o.id, slot)).length

  return (
    <div className="admin-inner fade-in">
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onClick={onBack}><Icon name="left" />All residents</button>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="patient-head">
          <Avatar id={r.id} name={r.name} size={64} dim={away} />
          <div className="grow">
            <div className="eyebrow">{r.bed} · {slot} round</div>
            <h2>{fullName(r)}</h2>
            <div className="ids" style={{ marginTop: 6 }}>
              <span>Born <b className="num">{new Date(r.dob).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</b> ({age(r.dob, s.day)})</span>
              <span>NRIC <b className="num">{r.nric}</b></span>
              <span>Speaks <b>{r.languages.join(', ')}</b></span>
            </div>
          </div>
          <Ring done={rs.done} total={rs.total} size={52} />
        </div>
        {r.allergies.length ? (
          <div className="allergy-band">
            <Icon name="alert" />
            <span>Allergies:</span>
            {r.allergies.map((a) => <span key={a.substance}>{a.substance} ({a.reaction}{a.type === 'intolerance' ? ', intolerance' : ''})</span>)}
          </div>
        ) : (
          <div className="allergy-band none"><Icon name="check" />No known drug allergies</div>
        )}
      </div>

      {away && <Banner tone="info" icon="bed" title="Away from the home. Doses are suspended.">{r.statusNote}</Banner>}
      {(!r.swallow.startsWith('Normal') || r.flags.includes('dysphagia')) && !away && (
        <Banner tone="warning" icon="drop" title="Swallowing">{r.swallow}. Diet: {r.diet}.</Banner>
      )}

      {!away && (
        <div className="card id-step">
          <span className={`step-num${idCheck ? ' done' : ''}`}>{idCheck ? <Icon name="check" size={18} /> : '1'}</span>
          <div className="grow">
            <b>{idCheck ? 'Identity confirmed' : 'Confirm who you are giving to'}</b>
            <span className="small muted">
              {idCheck ? `${idCheck.method === 'wristband' ? 'Wristband scanned' : 'Photo and two identifiers'} at ${clock(idCheck.t)} by ${staff(idCheck.by)?.short}` : 'Scan the wristband. If it cannot be scanned, check the photo, name and date of birth.'}
            </span>
          </div>
          {!idCheck && (
            <div className="row wrap">
              <button className="btn ghost" onClick={() => setSheet({ kind: 'manual-id' })}>Can't scan</button>
              <button className="btn primary lg" onClick={() => setSheet({ kind: 'wristband' })}><Icon name="scan" />Scan wristband</button>
            </div>
          )}
        </div>
      )}

      {pendingVerify && !away && (
        <Banner tone="warning" icon="shield" title="Admission medicines need verification before the first dose">
          Transcribed by {staff(rs.orders.find(awaitingVerification)?.transcribed?.by)?.name} from {rs.orders.find(awaitingVerification)?.transcribed?.source}. A different RN checks them.{' '}
          {me && isRn(me.role) && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setSheet({ kind: 'verify' })}>Verify now</button>}
        </Banner>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'due'} onClick={() => setTab('due')}>Due at {slot} <span className="count">{rs.total}</span></button>
        <button role="tab" aria-selected={tab === 'prn'} onClick={() => setTab('prn')}>As needed (PRN) <span className="count">{prnOrders.length}</span>{pendingEffects.length > 0 && <Chip tone="warning">effect check</Chip>}</button>
      </div>

      {tab === 'due' && (
        <>
          {(blister.length > 0 || stopped.length > 0) && (
            <div className="card" style={{ overflow: 'hidden', opacity: idCheck || away ? 1 : 0.6 }}>
              <div className="card-h" style={{ paddingBottom: 12 }}>
                <span className="med-icon tone-accent"><Icon name="layers" /></span>
                <div className="grow">
                  <h3>Blister pack, {slot}</h3>
                  <span className="small muted">Pharmacy multi-dose pack, {slot} bubble · {blister.length} medicine{blister.length === 1 ? '' : 's'}{stopped.length ? ` · ${stopped.length} stopped` : ''} · <span className="mono">{blisterBarcode(rid, s.day, slot)}</span></span>
                </div>
                {blisterPending > 0 && (
                  blister.every((o) => scanned.has(o.id) || findAdmin(s, o.id, slot))
                    ? <button className="btn ok" disabled={!readyForAll || !idCheck} onClick={giveAllBlister}><Icon name="check" />Give all {blisterPending}</button>
                    : <button className="btn primary" disabled={!idCheck} onClick={() => setSheet({ kind: 'scan', orderIds: blister.map((o) => o.id) })}><Icon name="scan" />Scan blister pack</button>
                )}
              </div>
              {blister.map((o) => (
                <MedRow key={o.id} o={o} slot={slot} scanned={scanned.has(o.id)} enabled={!!idCheck} value={values[o.id] ?? ''}
                  onValue={(v) => setValues((x) => ({ ...x, [o.id]: v }))}
                  onScan={() => setSheet({ kind: 'scan', orderIds: blister.map((x) => x.id) })}
                  onGive={() => (needsWitness(o) ? setSheet({ kind: 'witness', order: o }) : give(o))}
                  onNotGiven={() => setSheet({ kind: 'notgiven', order: o })} />
              ))}
              {stopped.map((o) => <StoppedRow key={o.id} o={o} slot={slot} enabled={!!idCheck} />)}
            </div>
          )}
          {packs.length > 0 && (
            <div className="card" style={{ overflow: 'hidden', opacity: idCheck || away ? 1 : 0.6 }}>
              <div className="card-h" style={{ paddingBottom: 12 }}>
                <span className="med-icon"><Icon name="vial" /></span>
                <div className="grow">
                  <h3>Separate packs</h3>
                  <span className="small muted">Scan each one</span>
                </div>
              </div>
              {packs.map((o) => (
                <MedRow key={o.id} o={o} slot={slot} scanned={scanned.has(o.id)} enabled={!!idCheck} value={values[o.id] ?? ''}
                  onValue={(v) => setValues((x) => ({ ...x, [o.id]: v }))}
                  onScan={() => setSheet({ kind: 'scan', orderIds: [o.id] })}
                  onGive={() => (needsWitness(o) ? setSheet({ kind: 'witness', order: o }) : give(o))}
                  onNotGiven={() => setSheet({ kind: 'notgiven', order: o })} />
              ))}
            </div>
          )}
          {allDone && !away && (
            <div className="card id-step fade-in" style={{ background: 'var(--ok-soft)', borderColor: 'transparent' }}>
              <span className="step-num done"><Icon name="check" size={18} /></span>
              <div className="grow"><b style={{ color: 'var(--ok-ink)' }}>{r.preferred}'s {slot} medicines are all recorded</b></div>
              {next && <button className="btn primary lg" onClick={() => onNext(next.id)}>Next: {next.preferred}, {next.bed}<Icon name="right" /></button>}
            </div>
          )}
        </>
      )}

      {tab === 'prn' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {prnOrders.length === 0 && <div className="empty">No as-needed medicines prescribed.</div>}
          {prnOrders.map((o) => {
            const ps = prnStatus(s, o)
            const pend = pendingEffects.find((p) => p.orderId === o.id)
            return (
              <div className="med" key={o.id}>
                <div className="med-top">
                  <span className={`med-icon${o.cd ? ' tone-hi' : ''}`}><Icon name={o.route === 'Oral' ? 'pill' : 'syringe'} /></span>
                  <div className="grow">
                    <div className="med-name">{o.drug}</div>
                    <div className="med-dose">{o.dose} · {o.route} · when: {o.prn!.reason.toLowerCase()}</div>
                    <div className="med-meta">At least {o.prn!.minHours >= 1 ? `${o.prn!.minHours} h` : `${o.prn!.minHours * 60} min`} apart · max {o.prn!.maxPer24h} in 24 h · {ps.in24} given in the last 24 h</div>
                  </div>
                  <div className="row wrap">{o.cd && <Chip tone="hi">Controlled drug</Chip>}</div>
                </div>
                {ps.last && <div className="med-instr">Last given {when(ps.last.t, s.day)} by {staff(ps.last.by)?.short} for {ps.last.reason.toLowerCase()}{ps.last.pain !== undefined ? ` (pain ${ps.last.pain}/10)` : ''}. {ps.last.effect ? `Effect: ${ps.last.effect.result}. ${ps.last.effect.text}` : 'Effect not yet recorded.'}</div>}
                <div className="med-actions">
                  {pend && <button className="btn" onClick={() => setSheet({ kind: 'effect', prnId: pend.id, order: o })}><Icon name="check" />Record effect</button>}
                  <span className="spacer" />
                  {ps.blockedReason ? <span className="small" style={{ color: 'var(--warn-ink)', fontWeight: 600 }}>{ps.blockedReason}</span> : null}
                  <button className="btn primary" disabled={!!ps.blockedReason || away} onClick={() => setSheet({ kind: 'prn', order: o })}>Give as needed</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {sheet?.kind === 'wristband' && (
        <ScanSheet title="Scan wristband" sub={`${fullName(r)} · ${r.bed}`} onClose={() => setSheet(null)}
          options={[
            { code: `WB-${r.id.slice(2).toUpperCase()}`, label: `Wristband on ${r.preferred}'s wrist`, note: 'Bedside' },
            ...s.residents.filter((x) => x.id !== r.id && x.status === 'in' && Math.abs(parseInt(x.bed.slice(3)) - parseInt(r.bed.slice(3))) === 1)
              .map((x) => ({ code: `WB-${x.id.slice(2).toUpperCase()}`, label: `Wristband of the resident in ${x.bed}`, note: 'Next bed' })),
          ]}
          onCode={async (code) => {
            const res = await act('identity.confirm', { rid, slot, method: 'wristband', barcode: code }, { quiet: true })
            if (res.ok) { setSheet(null); toast(`Identity confirmed: ${fullName(r)}.`); return null }
            return { ok: false, kind: 'wrong-resident', title: res.message, detail: res.ok ? '' : res.detail ?? '', orderIds: [] } as ScanResult
          }} />
      )}
      {sheet?.kind === 'manual-id' && <ManualIdSheet r={r} slot={slot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'scan' && (
        <ScanSheet title="Scan medicine" sub={`For ${fullName(r)} · ${slot}`} onClose={() => setSheet(null)}
          options={trolley(s, r, slot, sheet.orderIds)}
          onCode={async (code) => {
            const res = await act<ScanResult>('scan.verify', { rid, slot, barcode: code }, { quiet: true })
            if (!res.ok) return { ok: false, kind: 'not-prescribed', title: res.message, detail: res.detail ?? '', orderIds: [] }
            const result = res.data!
            if (result.ok) {
              setScanned((x) => new Set([...x, ...result.orderIds]))
              setSheet(null)
              toast(`${result.title}. ${result.detail}`)
              return null
            }
            return result
          }} />
      )}
      {sheet?.kind === 'witness' && (
        <WitnessSheet order={sheet.order} r={r} slot={slot} value={values[sheet.order.id]} onClose={() => setSheet(null)} onSubmit={async (w) => {
          const res = await give(sheet.order, w)
          if (res.ok) { setSheet(null); toast(`${sheet.order.drug.split(' (')[0]} given with second check.${res.message ? ` ${res.message}` : ''}`) }
          return res
        }} />
      )}
      {sheet?.kind === 'notgiven' && <NotGivenSheet order={sheet.order} r={r} slot={slot} value={values[sheet.order.id]} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'prn' && <PrnSheet order={sheet.order} r={r} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'effect' && <EffectSheet prnId={sheet.prnId} order={sheet.order} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'verify' && <VerifySheet r={r} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** A medicine the doctor stopped mid-cycle that is still in the blister bubble: pop it out and discard it. */
function StoppedRow({ o, slot, enabled }: { o: Order; slot: string; enabled: boolean }) {
  const { s, staff, act } = useApp()
  const admin = findAdmin(s, o.id, slot)
  const by = staff(o.stopped!.by)
  return (
    <div className={`med${admin ? ' done' : ''}`}>
      <div className="med-top">
        <span className="med-icon tone-critical"><Icon name="stop" /></span>
        <div className="grow">
          <div className="med-name"><s>{o.drug}</s></div>
          <div className="med-dose">{o.dose} · stopped by {by?.name ?? 'the doctor'}, {when(o.stopped!.t, s.day).replace(/^Yesterday/, 'yesterday')}</div>
        </div>
        <div className="med-state">
          <Chip tone={admin ? 'ok' : 'critical'} lg>{admin ? <><Icon name="check" />Discarded {clock(admin.t)} · {staff(admin.by)?.short}</> : 'Stopped, still in pack'}</Chip>
        </div>
      </div>
      {!admin && (
        <>
          <div className="med-instr">Do not give. Pop it out of the {slot} bubble and discard it. Reason stopped: {o.stopped!.reason}.</div>
          <div className="med-actions">
            <span className="spacer" />
            <button className="btn primary" disabled={!enabled} onClick={() => act('blister.discard', { orderId: o.id, slot }, { success: `${o.drug.split(' (')[0]} discarded.` })}>
              <Icon name="check" />Popped out and discarded
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function MedRow({ o, slot, scanned, enabled, value, onValue, onScan, onGive, onNotGiven }: {
  o: Order; slot: string; scanned: boolean; enabled: boolean; value: string; onValue: (v: string) => void; onScan: () => void; onGive: () => void; onNotGiven: () => void
}) {
  const { s, staff, me } = useApp()
  const r = residentOf(s, o.rid)!
  const admin = findAdmin(s, o.id, slot)
  const state = doseState(o, slot, s.now, admin, r)
  const adv = checkAdvice(o, value === '' ? undefined : Number(value))
  const verifying = awaitingVerification(o)
  const needRn = rnOnly(o) && me && !isRn(me.role)
  const icon = o.route === 'Subcutaneous' ? 'syringe' : o.dose.includes('mL') ? 'drop' : 'pill'
  const outcomeTone = admin?.outcome === 'given' ? 'ok' : admin ? 'warning' : state === 'overdue' ? 'critical' : state === 'due' ? 'accent' : undefined
  const stateLabel = admin
    ? `${admin.outcome[0].toUpperCase()}${admin.outcome.slice(1)} ${clock(admin.t)} · ${staff(admin.by)?.short}`
    : state === 'overdue' ? `Overdue since ${clock(slotMin(slot) + (o.timeCritical ? 30 : 60))}` : state === 'due' ? 'Due now' : state === 'suspended' ? 'Suspended' : `Due ${slot}`
  return (
    <div className={`med${admin ? ' done' : ''}`}>
      <div className="med-top">
        <span className={`med-icon${o.highAlert || o.cd ? ' tone-hi' : ''}`}><Icon name={icon} /></span>
        <div className="grow">
          <div className="med-name">{o.drug}</div>
          <div className="med-dose">{o.dose} · {o.route}{o.indication ? ` · for ${o.indication.toLowerCase()}` : ''}</div>
          <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
            {o.timeCritical && <Chip tone="warning" icon="clock">Time-critical</Chip>}
            {o.highAlert && <Chip tone="hi" icon="alert">High-alert · second check</Chip>}
            {o.cd && <Chip tone="hi" icon="shield">Controlled drug · RN + witness</Chip>}
            {o.weekly !== undefined && <Chip tone="accent">Weekly, today</Chip>}
            {o.ownSupply && <Chip tone="caution" title={o.ownSupply}>Own supply from home</Chip>}
            {verifying && <Chip tone="caution">Awaiting RN verification</Chip>}
            {o.cd && s.cdStock[o.id] && <span className="tiny muted">Register balance {s.cdStock[o.id].balance} {s.cdStock[o.id].unit}</span>}
          </div>
        </div>
        <div className="med-state">
          <Chip tone={outcomeTone} lg>{admin?.outcome === 'given' && <Icon name="check" />}{stateLabel}</Chip>
        </div>
      </div>
      {o.instructions && !admin && <div className="med-instr">{o.instructions}</div>}
      {o.ownSupply && !admin && <div className="tiny muted">{o.ownSupply}.</div>}
      {admin && admin.outcome !== 'given' && <div className="med-instr">Reason: {admin.reason}{admin.note ? `. ${admin.note}` : ''}</div>}
      {admin?.witness && <div className="tiny muted">Second check by {staff(admin.witness)?.name}{admin.values ? ` · ${Object.entries(admin.values).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}` : ''}</div>}
      {!admin && state !== 'suspended' && (
        <>
          {o.check && (
            <div className="check-box">
              <div className="field">
                <label htmlFor={`chk-${o.id}`}>{o.check.label} before giving</label>
                <div className="unit-wrap">
                  <input id={`chk-${o.id}`} className="input big" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value.replace(/[^\d.]/g, ''))} disabled={!enabled} placeholder="–" />
                  <span className="unit">{o.check.unit}</span>
                </div>
              </div>
              <div className="grow small" style={{ paddingBottom: 12 }}>
                {adv ? <span style={{ color: adv.tone === 'critical' ? 'var(--crit)' : adv.tone === 'warning' ? 'var(--warn-ink)' : 'var(--ok-ink)', fontWeight: 650 }}>{adv.text}</span>
                  : <span className="muted">{o.check.holdBelow !== undefined ? `Hold if below ${o.check.holdBelow} ${o.check.unit}.` : ''}</span>}
              </div>
            </div>
          )}
          <div className="med-actions">
            {scanned ? <Chip tone="ok" icon="check">Scanned, matches</Chip> : <span className="small muted">{o.supply === 'blister' ? 'In the blister pack' : <>Original pack <span className="mono">{packBarcode(o.id)}</span></>}</span>}
            <span className="spacer" />
            <button className="btn" disabled={!enabled} onClick={onNotGiven}>Not given</button>
            {!scanned ? (
              <button className="btn primary" disabled={!enabled} onClick={onScan}><Icon name="scan" />Scan</button>
            ) : (
              <button className="btn ok" disabled={!enabled || verifying || (!!o.check && (!value || adv?.tone === 'critical'))} onClick={onGive} title={needRn ? 'A registered nurse must give this' : undefined}>
                <Icon name="check" />{needsWitness(o) ? 'Give with second check' : 'Give'}
              </button>
            )}
          </div>
          {needRn && <div className="small" style={{ color: 'var(--hi-ink)', fontWeight: 600 }}>{o.cd ? 'Controlled drugs' : 'Injectables'} are prepared and given by an RN. Ask the RN on shift; you can be the second checker.</div>}
        </>
      )}
    </div>
  )
}

function trolley(s: ReturnType<typeof useApp>['s'], r: Resident, slot: string, orderIds: string[]) {
  const opts: { code: string; label: string; note: string }[] = []
  const orders = s.orders.filter((o) => orderIds.includes(o.id))
  if (orders.some((o) => o.supply === 'blister')) opts.push({ code: blisterBarcode(r.id, s.day, slot), label: `Blister pack: ${r.name}, ${slot}`, note: `${orders.length} medicines · ${slot} bubble` })
  for (const o of orders.filter((x) => x.supply === 'pack')) opts.push({ code: packBarcode(o.id), label: `${o.drug} · ${r.name}`, note: 'Labelled pack' })
  const neighbour = s.residents.find((x) => x.id !== r.id && x.status === 'in' && s.orders.some((o) => o.rid === x.id && o.slots.includes(slot) && o.supply === 'blister'))
  if (neighbour) opts.push({ code: blisterBarcode(neighbour.id, s.day, slot), label: `Blister pack: ${neighbour.name}, ${slot}`, note: `${neighbour.bed} · next card in the trolley` })
  for (const d of s.decoyPacks) opts.push({ code: d.barcode, label: d.label, note: d.note })
  return opts
}

function ScanSheet({ title, sub, options, onCode, onClose }: {
  title: string; sub: string; options: { code: string; label: string; note: string }[]; onCode: (code: string) => Promise<ScanResult | null>; onClose: () => void
}) {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (code: string) => {
    setBusy(true)
    const res = await onCode(code)
    setBusy(false)
    setResult(res)
  }
  if (result && !result.ok) {
    return (
      <Sheet title={result.kind === 'allergy' ? 'Allergy block' : 'Do not give'} sub="Stopped before it reached the resident" icon="stop" tone="critical" onClose={onClose}
        footer={<><button className="btn" onClick={() => setResult(null)}>Scan again</button><button className="btn danger" onClick={onClose}>I've put it aside</button></>}>
        <div className="banner critical" role="alert" style={{ padding: 18 }}>
          <Icon name="stop" />
          <div>
            <b style={{ fontSize: 18 }}>{result.title}</b>
            <div style={{ marginTop: 6, fontSize: 15 }}>{result.detail}</div>
          </div>
        </div>
        <p className="small muted">This near miss is in the audit trail, and the nurse in charge has an alert to review it for the medication safety log.</p>
      </Sheet>
    )
  }
  return (
    <Sheet title={title} sub={sub} icon="scan" onClose={onClose}>
      <div className="scan-view" aria-hidden>
        <div className="scan-frame" />
        <div className="scan-line" />
        <div className="scan-hint">Point the camera at the barcode</div>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Demo: tap what the camera sees</div>
        <div className="stack" style={{ gap: 8 }}>
          {options.map((o) => (
            <button key={o.code} className="pack-opt" disabled={busy} onClick={() => run(o.code)}>
              <span className="barcode" />
              <span className="grow"><b style={{ display: 'block' }}>{o.label}</b><span className="small muted">{o.note} · <span className="mono">{o.code}</span></span></span>
              <Icon name="right" size={18} />
            </button>
          ))}
        </div>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed) run(typed.trim()) }}>
        <label htmlFor="typed-code" className="sr">Type a barcode</label>
        <input id="typed-code" className="input" placeholder="Or type the barcode" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} />
        <button className="btn" type="submit" disabled={!typed || busy}>Check</button>
      </form>
    </Sheet>
  )
}

function ManualIdSheet({ r, slot, onClose }: { r: Resident; slot: string; onClose: () => void }) {
  const { act, s } = useApp()
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const reasons = ['Wristband damaged or unreadable', 'Resident removed the wristband', 'Fragile skin, wristband off', 'Scanner not working']
  return (
    <Sheet title="Confirm identity without scanning" sub="Use the photo and two identifiers" icon="user" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!reason || !checked} onClick={async () => {
        const res = await act('identity.confirm', { rid: r.id, slot, method: 'manual', reason }, { success: 'Identity confirmed.' })
        if (res.ok) onClose()
      }}>Confirm identity</button></>}>
      <div className="row" style={{ gap: 14 }}>
        <Avatar id={r.id} name={r.name} size={72} />
        <dl className="kv grow" style={{ margin: 0 }}>
          <dt>Name</dt><dd><b>{fullName(r)}</b></dd>
          <dt>Date of birth</dt><dd className="num">{new Date(r.dob).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })} ({age(r.dob, s.day)})</dd>
          <dt>Bed</dt><dd>{r.bed}</dd>
        </dl>
      </div>
      <div className="field">
        <span className="label">Why can't the wristband be scanned?</span>
        <div className="choice">{reasons.map((x) => <button key={x} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
      </div>
      <label className="row" style={{ gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1 }} />
        <span>I have matched the photo, and the resident (or a colleague who knows them) confirmed the name and date of birth.</span>
      </label>
    </Sheet>
  )
}

function WitnessSheet({ order, r, slot, value, onClose, onSubmit }: {
  order: Order; r: Resident; slot: string; value?: string; onClose: () => void; onSubmit: (w: { id: string; pin: string }) => Promise<{ ok: boolean; message?: string }>
}) {
  const { s, me } = useApp()
  const [wid, setWid] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const nurses = s.staff.filter((x) => x.id !== me?.id && (x.role === 'RN' || x.role === 'EN' || x.role === 'NM') && x.shift !== 'night')
  const w = s.staff.find((x) => x.id === wid)
  return (
    <Sheet title="Second check" sub={`${order.cd ? 'Controlled drug' : 'High-alert medicine'} · ${fullName(r)} · ${slot}`} icon="hand" tone="hi" onClose={onClose}>
      <div className="card" style={{ padding: 14, background: 'var(--surface-2)', boxShadow: 'none' }}>
        <div className="med-name">{order.drug}</div>
        <div className="med-dose">{order.dose} · {order.route}</div>
        {order.check && value && <div className="small" style={{ marginTop: 6 }}>{order.check.label}: <b className="num">{value} {order.check.unit}</b></div>}
        {order.cd && s.cdStock[order.id] && <div className="small" style={{ marginTop: 6 }}>Register balance now <b className="num">{s.cdStock[order.id].balance} {s.cdStock[order.id].unit}</b>. Count the stock together before you sign.</div>}
      </div>
      {!w ? (
        <div className="field">
          <span className="label">Who is checking with you?</span>
          <div className="who-grid">
            {nurses.map((x) => (
              <button key={x.id} className="who-card" onClick={() => { setErr(null); setWid(x.id) }}>
                <span className="row" style={{ justifyContent: 'center' }}><Avatarish id={x.id} name={x.name} /></span>
                <b>{x.name}</b><span>{x.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <div className="row"><Avatarish id={w.id} name={w.name} /><b>{w.name}</b><button className="btn ghost sm" onClick={() => setWid(null)}>Change</button></div>
          <div className="small muted" style={{ textAlign: 'center' }}>{w.short}: check the resident, the medicine, the dose and the time, then enter your PIN.</div>
          <PinPad error={err} onDone={async (pin) => {
            const res = await onSubmit({ id: w.id, pin })
            if (!res.ok) setErr(res.message ?? 'Not accepted')
          }} />
        </div>
      )}
    </Sheet>
  )
}

const Avatarish = ({ id, name }: { id: string; name: string }) => <Avatar id={id} name={name} size={44} />

const NOT_GIVEN: { label: string; outcome: string }[] = [
  { label: 'Resident refused', outcome: 'refused' },
  { label: 'Resident asleep', outcome: 'held' },
  { label: 'Vital signs out of range', outcome: 'held' },
  { label: 'Nil by mouth', outcome: 'held' },
  { label: 'Vomiting', outcome: 'held' },
  { label: 'Away from the ward', outcome: 'held' },
  { label: 'Medicine not available', outcome: 'unavailable' },
  { label: 'Doctor asked to hold', outcome: 'held' },
]

function NotGivenSheet({ order, r, slot, value, onClose }: { order: Order; r: Resident; slot: string; value?: string; onClose: () => void }) {
  const { act } = useApp()
  const [reason, setReason] = useState<string | null>(() => (order.check && value && checkAdvice(order, Number(value))?.tone === 'critical' ? 'Vital signs out of range' : null))
  const [note, setNote] = useState('')
  const chosen = NOT_GIVEN.find((x) => x.label === reason)
  return (
    <Sheet title="Not given" sub={`${order.drug} · ${fullName(r)} · ${slot}`} icon="hand" tone="warning" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!chosen} onClick={async () => {
        const res = await act('dose.record', { orderId: order.id, slot, outcome: chosen!.outcome, reason, note: note || undefined, values: order.check && value ? { [order.check.field]: Number(value) } : undefined }, { success: 'Recorded.' })
        if (res.ok) onClose()
      }}>Record</button></>}>
      {(order.timeCritical || order.highAlert) && <Banner tone="warning" title="The nurse in charge will be alerted">{order.timeCritical ? 'This is a time-critical medicine.' : 'This is a high-alert medicine.'} Missing it may need a doctor's advice.</Banner>}
      <div className="field">
        <span className="label">Reason</span>
        <div className="choice">{NOT_GIVEN.map((x) => <button key={x.label} aria-pressed={reason === x.label} onClick={() => setReason(x.label)}>{x.label}</button>)}</div>
      </div>
      <div className="field">
        <label htmlFor="ng-note">Note (optional)</label>
        <textarea id="ng-note" className="textarea" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, and what you did next" />
      </div>
    </Sheet>
  )
}

function PrnSheet({ order, r, onClose }: { order: Order; r: Resident; onClose: () => void }) {
  const { act, s, me } = useApp()
  const [reason, setReason] = useState('')
  const [pain, setPain] = useState<number | null>(null)
  const [step, setStep] = useState<'form' | 'witness'>('form')
  const [wid, setWid] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const reasons = order.prn!.reason.toLowerCase().includes('pain') ? ['Pain', 'Fever above 38 °C', 'Pain on repositioning', 'Headache'] : [order.prn!.reason]
  const submit = async (witness?: { id: string; pin: string }) => {
    const res = await act('prn.give', { orderId: order.id, reason, pain: pain ?? undefined, witnessId: witness?.id, witnessPin: witness?.pin }, { success: `${order.drug.split(' ')[0]} given.`, quiet: !!witness })
    if (res.ok) onClose()
    else if (witness) setErr(res.message)
  }
  const nurses = s.staff.filter((x) => x.id !== me?.id && ['RN', 'EN', 'NM'].includes(x.role) && x.shift !== 'night')
  return (
    <Sheet title={`Give ${order.drug.split(' (')[0]}`} sub={`${order.dose} · ${fullName(r)}`} icon="pill" onClose={onClose}
      footer={step === 'form' ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!reason} onClick={() => (needsWitness(order) ? setStep('witness') : submit())}>{needsWitness(order) ? 'Next: second check' : 'Give and record'}</button></> : undefined}>
      {step === 'form' ? (
        <>
          <div className="field">
            <span className="label">Reason</span>
            <div className="choice">{reasons.map((x) => <button key={x} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
          </div>
          <div className="field">
            <span className="label">Pain score now (0 = none, 10 = worst)</span>
            <div className="choice">{Array.from({ length: 11 }, (_, i) => <button key={i} aria-pressed={pain === i} onClick={() => setPain(i)} style={{ minWidth: 44, textAlign: 'center' }}>{i}</button>)}</div>
          </div>
          <p className="small muted">An effect check will be added to the task list for 1 hour from now.</p>
        </>
      ) : !wid ? (
        <div className="who-grid">
          {nurses.map((x) => <button key={x.id} className="who-card" onClick={() => setWid(x.id)}><Avatar id={x.id} name={x.name} size={44} /><b>{x.name}</b><span>{x.title}</span></button>)}
        </div>
      ) : (
        <PinPad error={err} onDone={(pin) => submit({ id: wid, pin })} />
      )}
    </Sheet>
  )
}

function EffectSheet({ prnId, order, onClose }: { prnId: string; order: Order; onClose: () => void }) {
  const { act } = useApp()
  const [result, setResult] = useState<string | null>(null)
  const [text, setText] = useState('')
  return (
    <Sheet title="Did it work?" sub={order.drug} icon="check" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Later</button><button className="btn primary" disabled={!result} onClick={async () => {
        const res = await act('prn.effect', { prnId, result, text }, { success: 'Effect recorded.' })
        if (res.ok) onClose()
      }}>Save</button></>}>
      <div className="choice">{['effective', 'partial', 'not effective'].map((x) => <button key={x} aria-pressed={result === x} onClick={() => setResult(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
      <div className="field">
        <label htmlFor="eff-text">What you saw</label>
        <input id="eff-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: pain 2/10, sleeping" />
      </div>
    </Sheet>
  )
}

function VerifySheet({ r, onClose }: { r: Resident; onClose: () => void }) {
  const { s, act, toast, staff } = useApp()
  const [err, setErr] = useState<string | null>(null)
  const orders = s.orders.filter((o) => o.rid === r.id && awaitingVerification(o))
  const tr = orders[0]?.transcribed
  return (
    <Sheet title="Verify admission medicines" sub={`${fullName(r)} · transcribed by ${staff(tr?.by)?.name} ${tr ? when(tr.t, s.day) : ''}`} icon="shield" tone="caution" onClose={onClose} wide>
      <Banner tone="info" title={`Check against: ${tr?.source}`}>Compare each line with the source prescription. If anything differs, do not verify; call the doctor. Doctor endorsement is due {tr ? when(tr.endorseDue, s.day) : ''}.</Banner>
      <div className="card" style={{ overflow: 'hidden', boxShadow: 'none' }}>
        {orders.map((o) => (
          <div className="med" key={o.id}>
            <div className="med-name">{o.drug}</div>
            <div className="med-dose">{o.dose} · {o.route} · {o.slots.join(', ')}{o.indication ? ` · for ${o.indication.toLowerCase()}` : ''}</div>
          </div>
        ))}
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>Enter your PIN to sign the verification.</div>
      <PinPad error={err} onDone={async (pin) => {
        const res = await act('order.verify', { rid: r.id, pin }, { quiet: true })
        if (res.ok) { toast('Admission medicines verified. Doses can now be given.'); onClose() } else setErr(res.message)
      }} />
    </Sheet>
  )
}

export function CdRegister({ onClose }: { onClose: () => void }) {
  const { s, staff } = useApp()
  const cdOrders = s.orders.filter((o) => o.cd)
  const [oid, setOid] = useState(cdOrders[0]?.id)
  const o = cdOrders.find((x) => x.id === oid)
  const rows = s.cdLedger.filter((e) => e.orderId === oid).sort((a, b) => b.seq - a.seq)
  return (
    <Sheet title="Controlled drug register" sub={`${s.ward.name} · electronic register, entries cannot be edited`} icon="vial" tone="hi" onClose={onClose} wide>
      <div className="seg" role="group" aria-label="Choose drug">
        {cdOrders.map((x) => <button key={x.id} aria-pressed={x.id === oid} onClick={() => setOid(x.id)}>{x.drug.split(' (')[0]} · {residentOf(s, x.rid)?.preferred}</button>)}
      </div>
      {o && (
        <div className="row wrap" style={{ gap: 18 }}>
          <div><div className="eyebrow">Balance</div><div style={{ fontSize: 28, fontWeight: 750 }} className="num">{s.cdStock[o.id].balance} <span className="small muted">{s.cdStock[o.id].unit}</span></div></div>
          <div className="grow small muted">{o.drug} · {o.dose} · for {fullName(residentOf(s, o.rid)!)}. Every entry needs an RN and a witness. Corrections are new entries by the nurse manager.</div>
        </div>
      )}
      <div className="mar-wrap">
        <table className="mar">
          <thead><tr><th>When</th><th>Entry</th><th className="num">Change</th><th className="num">Balance</th><th>By / witness</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.seq}>
                <td className="num">{when(e.t, s.day)}</td>
                <td><b>{e.kind[0].toUpperCase() + e.kind.slice(1)}</b><div className="tiny muted">{e.note}</div></td>
                <td className="num" style={{ color: e.change < 0 ? 'var(--crit-ink)' : 'var(--ok-ink)', fontWeight: 700 }}>{e.change > 0 ? '+' : ''}{e.change}</td>
                <td className="num strong">{e.balance}</td>
                <td className="small">{staff(e.by)?.name}<div className="tiny muted">{e.witness ? `Witness: ${staff(e.witness)?.name}` : ''}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  )
}
