import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { Avatar, Banner, Chip, PinPad, Score, Sheet } from '../ui/kit'
import { clock, fullName, scoreTone, when } from '../domain/clinical'
import { activeAlerts, latestVitals, shiftNow } from '../domain/selectors'
import type { Resident, Snapshot } from '../domain/types'

interface Summary { r: Resident; watch: boolean; lines: { tone?: string; text: string }[]; undone: string[] }

function summarise(s: Snapshot, r: Resident, from: number): Summary {
  const lines: Summary['lines'] = []
  const orders = s.orders.filter((o) => o.rid === r.id)
  const admins = s.administrations.filter((a) => a.rid === r.id && a.day === 0 && a.t >= from)
  const notGiven = admins.filter((a) => a.outcome !== 'given')
  const given = admins.filter((a) => a.outcome === 'given')
  const prn = s.prn.filter((p) => orders.some((o) => o.id === p.orderId) && p.t >= from)
  const vit = s.vitals.filter((v) => v.rid === r.id).sort((a, b) => a.t - b.t)
  const lastV = vit[vit.length - 1]
  const startV = vit.filter((v) => v.t < from).slice(-1)[0]
  const alerts = activeAlerts(s, r.id).filter((a) => a.kind !== 'hospital')
  const notes = s.notes.filter((n) => n.rid === r.id && n.t >= from)
  const undone = s.tasks.filter((t) => t.rid === r.id && !t.done && t.due < s.now && t.due >= from - 60).map((t) => t.text)

  if (r.status !== 'in') lines.push({ text: r.statusNote ?? 'Away from the home.' })
  if (lastV && lastV.t >= from) {
    const delta = startV ? lastV.news2 - startV.news2 : 0
    lines.push({ tone: lastV.news2 >= 5 ? 'critical' : lastV.news2 >= 3 ? 'warning' : undefined, text: `NEWS2 ${lastV.news2} at ${clock(lastV.t)}${startV ? ` (${delta > 0 ? `up ${delta}` : delta < 0 ? `down ${-delta}` : 'no change'} since start of shift)` : ''}. Temp ${lastV.temp}, pulse ${lastV.pulse}, RR ${lastV.rr}, SpO₂ ${lastV.spo2}%.` })
  }
  for (const a of alerts) lines.push({ tone: a.severity === 'high' ? 'critical' : 'warning', text: `${a.title}.${a.dueT ? ` ${a.dueLabel ?? 'Due'} ${clock(a.dueT)}.` : ''}` })
  if (given.length) lines.push({ text: `${given.length} dose${given.length > 1 ? 's' : ''} given this shift.` })
  for (const a of notGiven) {
    const o = orders.find((x) => x.id === a.orderId)
    lines.push({ tone: 'warning', text: `${o?.drug.split(' (')[0]} ${a.slot} ${a.outcome}: ${a.reason?.toLowerCase()}.` })
  }
  for (const p of prn) {
    const o = orders.find((x) => x.id === p.orderId)
    lines.push({ text: `PRN ${o?.drug.split(' (')[0]} at ${clock(p.t)} for ${p.reason.toLowerCase()}.${p.effect ? ` Effect: ${p.effect.result}.` : ' Effect not yet checked.'}` })
  }
  for (const n of notes) lines.push({ text: `${n.kind}: ${n.text}` })
  const watch = alerts.some((a) => a.severity !== 'low') || (lastV?.news2 ?? 0) >= 3 || notGiven.length > 0 || r.flags.includes('new')
  return { r, watch, lines, undone }
}

export function HandoverView() {
  const { s, me, act, toast, staff } = useApp()
  const shift = shiftNow(s.now)
  const from = shift.start
  const sums = s.residents.map((r) => summarise(s, r, from)).sort((a, b) => Number(b.watch) - Number(a.watch) || a.r.bed.localeCompare(b.r.bed))
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [signing, setSigning] = useState(false)
  const [toId, setToId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const last = s.handovers[0]
  const undoneTotal = sums.reduce((n, x) => n + x.undone.length, 0)
  const incoming = s.staff.filter((x) => (x.role === 'RN' || x.role === 'EN') && x.id !== me?.id && x.shift !== shift.id)
  const signedThisShift = last && last.t >= from + 60 && last.from === me?.id

  const summaryText = () => sums.filter((x) => x.watch || extra[x.r.id]).map((x) => `${x.r.bed} ${x.r.preferred}: ${[...x.lines.map((l) => l.text), extra[x.r.id]].filter(Boolean).join(' ')}`).join('\n')

  return (
    <div className="page">
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="eyebrow">{shift.label} → {shift.next} · {clock(shift.start)}–{clock(shift.end)}</div>
          <h2 style={{ fontSize: 24, marginTop: 4 }}>Handover at {clock(shift.end)}</h2>
          <p className="muted" style={{ marginTop: 4 }}>Built from everything recorded this shift. Residents to watch come first. Add anything the record doesn't show.</p>
        </div>
        <button className="btn primary lg" disabled={!!signedThisShift} onClick={() => setSigning(true)}><Icon name="handover" />{signedThisShift ? 'Handover signed' : 'Sign handover'}</button>
      </div>

      <div className="today-strip">
        <div className="card stat-card"><span className="eyebrow">Residents</span><div className="big">{s.residents.filter((r) => r.status === 'in').length}<small> in · {s.residents.filter((r) => r.status !== 'in').length} in hospital</small></div></div>
        <div className="card stat-card"><span className="eyebrow">To watch</span><div className="big" style={{ color: 'var(--warn-ink)' }}>{sums.filter((x) => x.watch).length}</div></div>
        <div className="card stat-card"><span className="eyebrow">Care left undone</span><div className="big" style={{ color: undoneTotal ? 'var(--crit)' : undefined }}>{undoneTotal}</div><span className="small muted">Reason and outcome are needed for each</span></div>
        <div className="card stat-card"><span className="eyebrow">Last handover</span><div className="small" style={{ fontWeight: 600 }}>{last ? `${when(last.t, s.day)}: ${staff(last.from)?.short} to ${staff(last.to)?.short}` : 'None'}</div>{last?.summary && <span className="tiny muted">{last.summary.slice(0, 140)}{last.summary.length > 140 ? '…' : ''}</span>}</div>
      </div>

      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="list">
          {sums.map((x) => (
            <div className="handover-res" key={x.r.id}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Avatar id={x.r.id} name={x.r.name} size={40} dim={x.r.status !== 'in'} />
                <div className="grow">
                  <div className="bed-tag">{x.r.bed}</div>
                  <b>{fullName(x.r)}</b>
                  <div className="row wrap" style={{ marginTop: 6, gap: 4 }}>
                    {x.watch && <Chip tone="warning" icon="alert">Watch</Chip>}
                    {(() => { const v = latestVitals(s, x.r.id); return v ? <Score value={v.news2} tone={scoreTone(v.news2)} label={`NEWS2 ${v.news2}`} /> : null })()}
                  </div>
                </div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <ul className="ho-facts" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {x.lines.length === 0 && <li className="muted">Settled. Nothing new this shift.</li>}
                  {x.lines.map((l, i) => (
                    <li key={i} style={{ color: l.tone === 'critical' ? 'var(--crit-ink)' : l.tone === 'warning' ? 'var(--warn-ink)' : undefined, fontWeight: l.tone ? 600 : 400 }}>
                      <span aria-hidden style={{ color: 'var(--muted)' }}>•</span> {l.text}
                    </li>
                  ))}
                  {x.undone.map((u) => <li key={u} style={{ color: 'var(--crit-ink)' }}><Icon name="clock" size={16} /> Not done: {u}</li>)}
                </ul>
                <label htmlFor={`ho-${x.r.id}`} className="sr">Add to handover for {x.r.preferred}</label>
                <input id={`ho-${x.r.id}`} className="input" style={{ minHeight: 42, fontSize: 14 }} placeholder="Add to handover (optional)" value={extra[x.r.id] ?? ''} onChange={(e) => setExtra((v) => ({ ...v, [x.r.id]: e.target.value }))} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {signing && (
        <Sheet title="Sign handover" sub="The nurse taking over confirms with their PIN" icon="handover" onClose={() => setSigning(false)}>
          {undoneTotal > 0 && <Banner tone="warning" title={`${undoneTotal} care task${undoneTotal > 1 ? 's' : ''} left undone`}>They carry over to the next shift and stay in the audit trail.</Banner>}
          {!toId ? (
            <div className="who-grid">
              {incoming.map((x) => <button key={x.id} className="who-card" onClick={() => setToId(x.id)}><Avatar id={x.id} name={x.name} size={48} /><b>{x.name}</b><span>{x.title}</span></button>)}
            </div>
          ) : (
            <div className="stack" style={{ alignItems: 'center' }}>
              <div className="row"><Avatar id={toId} name={staff(toId)!.name} size={40} /><b>{staff(toId)!.name}</b><button className="btn ghost sm" onClick={() => setToId(null)}>Change</button></div>
              <PinPad error={err} onDone={async (pin) => {
                const res = await act('handover.sign', { toId, pin, shift: shift.id, shiftLabel: `${shift.label.replace(' shift', '')} to ${shift.next}`, summary: summaryText() }, { quiet: true })
                if (res.ok) { setSigning(false); toast(`Handover signed. ${staff(toId)!.short} has the ward.`) } else setErr(res.message)
              }} />
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
