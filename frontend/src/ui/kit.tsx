import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { DEMO_PIN } from '../api/engine'

const HUES = ['#2f6fdf', '#0f8a6a', '#b4532a', '#7a4fd0', '#c0377a', '#2b7f9e', '#8a6d1f', '#4b5fbd', '#a13f3f', '#3f7f3a']

export function Avatar({ id, name, size = 40, dim }: { id: string; name: string; size?: number; dim?: boolean }) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const parts = name.replace(/^(Mdm|Mr|Mrs|Ms|Dr)\s+/, '').split(/\s+/)
  const initials = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: HUES[h % HUES.length], opacity: dim ? 0.55 : 1 }} aria-hidden>
      {initials}
    </span>
  )
}

export function Chip({ tone, icon, children, lg, solid, title }: { tone?: string; icon?: string; children: ReactNode; lg?: boolean; solid?: boolean; title?: string }) {
  return (
    <span className={`chip${lg ? ' lg' : ''}${solid ? ' solid' : ''}${tone ? ` tone-${tone}` : ''}`} title={title}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  )
}

export function Score({ value, tone, label }: { value: number | string; tone: string; label?: string }) {
  return <span className={`score ${tone}`} title={label} aria-label={label}>{value}</span>
}

export function Ring({ done, total, size = 40, tone = 'var(--ok)' }: { done: number; total: number; size?: number; tone?: string }) {
  const r = size / 2 - 3.5
  const c = 2 * Math.PI * r
  const pct = total ? done / total : 0
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="4" strokeLinecap={pct > 0 ? "round" : "butt"} strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      {total ? `${done}/${total}` : '–'}
    </span>
  )
}

export function Sheet({ title, sub, onClose, children, footer, wide, icon, tone }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: string; tone?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="sheet-h">
          {icon && (
            <span className={`med-icon tone-${tone ?? 'accent'}`} style={{ borderRadius: 14 }}>
              <Icon name={icon} />
            </span>
          )}
          <div className="grow">
            <h2>{title}</h2>
            {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </div>
  )
}

/** Four-digit PIN entry with an on-screen keypad (ward tablets rarely have keyboards). */
export function PinPad({ onDone, error, busy }: { onDone: (pin: string) => void; error?: string | null; busy?: boolean }) {
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  useEffect(() => {
    if (error) {
      setShake(true)
      setPin('')
      const t = setTimeout(() => setShake(false), 400)
      return () => clearTimeout(t)
    }
  }, [error])
  const press = (d: string) => {
    if (busy) return
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) setTimeout(() => onDone(next), 120)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 14 }}>
      <div className={`pin-dots${shake ? ' err' : ''}`} aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <div className="small" style={{ minHeight: 20, color: error ? 'var(--crit)' : 'var(--muted)', fontWeight: 600 }}>
        {error ?? `Demo PIN for every user: ${DEMO_PIN}`}
      </div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button className="fn" onClick={() => setPin('')}>Clear</button>
        <button onClick={() => press('0')}>0</button>
        <button className="fn" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">⌫</button>
      </div>
    </div>
  )
}

export function Tick({ on, onClick, label }: { on: boolean; onClick?: () => void; label: string }) {
  return (
    <button className={`tick${on ? ' on' : ''}`} onClick={onClick} disabled={on} aria-label={label} aria-pressed={on}>
      <Icon name="check" />
    </button>
  )
}

export function Banner({ tone, icon, title, children }: { tone: string; icon?: string; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'critical' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'critical' ? 'stop' : tone === 'ok' ? 'check' : tone === 'warning' ? 'alert' : 'info')} />
      <div className="grow">
        {title && <b>{title}</b>}
        {children && <div className="small" style={{ marginTop: title ? 2 : 0 }}>{children}</div>}
      </div>
    </div>
  )
}

export function Choice<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: ReactNode; pts?: number }[]; value: T | undefined; onChange: (v: T) => void; label?: string
}) {
  return (
    <div className="choice" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.pts !== undefined && <span className="pts">{o.pts}</span>}
        </button>
      ))}
    </div>
  )
}
