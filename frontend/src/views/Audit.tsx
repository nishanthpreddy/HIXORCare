import { useState } from 'react'
import { useApp } from '../store'
import { Chip } from '../ui/kit'
import { when } from '../domain/clinical'

const GROUPS: Record<string, string[]> = {
  Medicines: ['Dose', 'PRN', 'Pack', 'Scan', 'Allergy', 'Identity', 'Transcription'],
  Care: ['Observations', 'Care', 'Assessment', 'Wound', 'Note', 'SBAR', 'Suggestion'],
  Safety: ['Allergy', 'Scan blocked', 'Identity mismatch', 'Alert'],
  Handover: ['Handover'],
}

export function Audit() {
  const { s, staff } = useApp()
  const [group, setGroup] = useState<string>('All')
  const [rid, setRid] = useState<string>('')
  const rows = s.audit.filter((e) => (group === 'All' || GROUPS[group].some((g) => e.action.startsWith(g))) && (!rid || e.rid === rid))
  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="seg" role="group" aria-label="Filter by type">
          {['All', ...Object.keys(GROUPS)].map((g) => <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
        <label htmlFor="audit-res" className="sr">Resident</label>
        <select id="audit-res" className="select" style={{ maxWidth: 280 }} value={rid} onChange={(e) => setRid(e.target.value)}>
          <option value="">All residents</option>
          {s.residents.map((r) => <option key={r.id} value={r.id}>{r.bed} · {r.name}</option>)}
        </select>
        <span className="spacer" />
        <Chip tone="ok" icon="shield" lg>Chain intact · {s.audit.length} entries</Chip>
      </div>
      <p className="small muted" style={{ maxWidth: 760 }}>
        Every action is written once and never changed. Each entry carries a fingerprint of the one before it, so a deleted or edited entry breaks the chain and shows up here.
      </p>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="mar-wrap" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <table className="audit-table">
            <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Resident</th><th>Details</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const r = e.rid ? s.residents.find((x) => x.id === e.rid) : null
                const p = staff(e.by)
                const tone = /block|mismatch|refused|held/i.test(e.action) ? 'critical' : /given|signed|verified|confirmed/i.test(e.action) ? 'ok' : undefined
                return (
                  <tr key={e.seq}>
                    <td className="num muted">{e.seq}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{when(e.t, s.day)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p?.name}<div className="tiny muted">{p?.role}</div></td>
                    <td><Chip tone={tone}>{e.action}</Chip></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r ? `${r.bed} ${r.preferred}` : '–'}</td>
                    <td style={{ minWidth: 260 }}>{e.detail}</td>
                    <td className="hash"><span className="chain-link" />{e.hash}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
