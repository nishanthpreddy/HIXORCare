import { useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../ui/Icon'
import { BedGrid } from './Today'
import { activeAlerts, riskChips } from '../domain/selectors'

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'allergy', label: 'Allergies' },
  { id: 'falls', label: 'Falls risk' },
  { id: 'dnacpr', label: 'DNACPR' },
  { id: 'away', label: 'In hospital' },
] as const

export function Residents() {
  const { s } = useApp()
  const [q, setQ] = useState('')
  const [f, setF] = useState<(typeof FILTERS)[number]['id']>('all')
  const list = s.residents.filter((r) => {
    const text = `${r.name} ${r.preferred} ${r.bed} ${r.diagnoses.join(' ')}`.toLowerCase()
    if (q && !text.includes(q.toLowerCase())) return false
    if (f === 'attention') return activeAlerts(s, r.id).some((a) => a.kind !== 'hospital')
    if (f === 'allergy') return r.allergies.length > 0
    if (f === 'falls') return riskChips(s, r.id).some((c) => c.label === 'Falls risk')
    if (f === 'dnacpr') return r.acp.resus === 'Do not attempt CPR'
    if (f === 'away') return r.status !== 'in'
    return true
  })
  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="unit-wrap grow" style={{ minWidth: 220, maxWidth: 420 }}>
          <label htmlFor="res-search" className="sr">Search residents</label>
          <input id="res-search" className="input" placeholder="Search name, bed or condition" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 44 }} />
          <span style={{ position: 'absolute', left: 14, top: 14, color: 'var(--muted)' }}><Icon name="search" size={20} /></span>
        </div>
        <div className="seg" role="group" aria-label="Filter residents">
          {FILTERS.map((x) => <button key={x.id} aria-pressed={f === x.id} onClick={() => setF(x.id)}>{x.label}</button>)}
        </div>
      </div>
      {list.length ? <BedGrid residents={list} /> : <div className="card empty">No residents match. Clear the search or pick another filter.</div>}
    </div>
  )
}
