import { useEffect, useRef, useState } from 'react'
import { AppProvider, useApp, type View } from './store'
import { Icon, Logo } from './ui/Icon'
import { Avatar, PinPad } from './ui/kit'
import { clock, dateOf, residentOf } from './domain/clinical'
import { activeAlerts, roundProgress, shiftNow } from './domain/selectors'
import { currentSlot } from './domain/clinical'
import type { Staff } from './domain/types'
import { Today } from './views/Today'
import { Round } from './views/Round'
import { Residents } from './views/Residents'
import { ResidentView } from './views/Resident'
import { HandoverView } from './views/Handover'
import { Alerts } from './views/Alerts'
import { Audit } from './views/Audit'
import { Manager } from './views/Manager'
import { Incidents } from './views/Incidents'

export default function App() {
  return (
    <AppProvider>
      {(ready) => (ready ? <Gate /> : <div className="empty" style={{ paddingTop: 120 }}>Loading Ward 2B…</div>)}
    </AppProvider>
  )
}

function Gate() {
  const { me, toasts } = useApp()
  return (
    <>
      {me ? <Shell /> : <Lock />}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={t.tone === 'critical' ? 'stop' : t.tone === 'ok' ? 'check' : 'info'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}

const NAV: { view: View; label: string; icon: string; hideSm?: boolean; roles?: string[] }[] = [
  { view: 'manager', label: 'Overview', icon: 'chart', roles: ['NM'] },
  { view: 'today', label: 'Today', icon: 'today' },
  { view: 'round', label: 'Med round', icon: 'pill' },
  { view: 'residents', label: 'Residents', icon: 'residents' },
  { view: 'handover', label: 'Handover', icon: 'handover' },
  { view: 'alerts', label: 'Alerts', icon: 'bell' },
  { view: 'incidents', label: 'Incidents', icon: 'flag', hideSm: true },
  { view: 'audit', label: 'Audit', icon: 'shield', hideSm: true },
]

const IDLE_LOCK_MS = 2 * 60_000

function Shell() {
  const { route: asked, go, s, lock, me } = useApp()
  // The manager overview is for nurse managers; anyone else lands on Today.
  const route = asked.view === 'manager' && me?.role !== 'NM' ? { view: 'today' as View } : asked
  useEffect(() => {
    let t = setTimeout(lock, IDLE_LOCK_MS)
    const bump = () => { clearTimeout(t); t = setTimeout(lock, IDLE_LOCK_MS) }
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }))
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, bump, { capture: true })) }
  }, [lock])
  const alertCount = activeAlerts(s).filter((a) => a.status === 'open').length
  const active = route.view === 'resident' ? 'residents' : route.view
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="rail-logo"><Logo size={42} /></div>
        {NAV.filter((n) => !n.roles || (me && n.roles.includes(me.role))).map((n) => (
          <button key={n.view} className={`rail-item${n.hideSm ? ' hide-sm' : ''}`} aria-current={active === n.view ? 'page' : undefined} onClick={() => go({ view: n.view })}>
            <Icon name={n.icon} />
            {n.label}
            {n.view === 'alerts' && alertCount > 0 && <span className="rail-badge">{alertCount}</span>}
          </button>
        ))}
        <RailFoot />
      </nav>
      <div className="main">
        <TopBar />
        {route.view === 'round' ? (
          <div className="content flush"><Round /></div>
        ) : (
          <main className="content">
            {route.view === 'manager' && <Manager />}
            {route.view === 'incidents' && <Incidents />}
            {route.view === 'today' && <Today />}
            {route.view === 'residents' && <Residents />}
            {route.view === 'resident' && <ResidentView key={route.rid} />}
            {route.view === 'handover' && <HandoverView />}
            {route.view === 'alerts' && <Alerts />}
            {route.view === 'audit' && <Audit />}
          </main>
        )}
      </div>
    </div>
  )
}

function RailFoot() {
  const { theme, setTheme } = useApp()
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  return (
    <div className="rail-foot">
      <button className="rail-item" onClick={() => setTheme(dark ? 'light' : 'dark')} title="Switch light or dark (night shift)">
        <Icon name={dark ? 'sun' : 'moon'} />
        {dark ? 'Day' : 'Night'}
      </button>
    </div>
  )
}

const TITLES: Record<View, string> = {
  manager: 'Overview', incidents: 'Incidents', today: 'Today', round: 'Medication round', residents: 'Residents', resident: 'Resident', handover: 'Shift handover', alerts: 'Alerts', audit: 'Audit trail',
}

function TopBar() {
  const { s, route: asked, me, lock, go, wards, setWard } = useApp()
  const route = asked.view === 'manager' && me?.role !== 'NM' ? { ...asked, view: 'today' as View } : asked
  const [menu, setMenu] = useState(false)
  const mine = me?.role === 'NM' ? wards.filter((w) => me.wards.includes(w.id)) : []
  const shift = shiftNow(s.now)
  const date = dateOf(s.day).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const r = route.view === 'resident' && route.rid ? residentOf(s, route.rid) : null
  return (
    <header className="topbar">
      {r ? (
        <button className="icon-btn" onClick={() => go({ view: 'residents' })} aria-label="Back to residents"><Icon name="left" /></button>
      ) : null}
      <div className="where grow">
        <h1>{r ? `${r.salutation} ${r.name}` : TITLES[route.view]}</h1>
        <span className="muted">{s.ward.name} · {s.ward.unit}<span className="hide-sm"> · {s.home.name}</span></span>
      </div>
      {mine.length > 1 && (
        <div className="seg ward-switch hide-sm" role="group" aria-label="Ward">
          {mine.map((w) => <button key={w.id} aria-pressed={w.id === s.ward.id} onClick={() => setWard(w.id)} title={`${w.name}, ${w.unit}`}>{w.code}</button>)}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <button className="clock-chip num" onClick={() => setMenu((m) => !m)} aria-expanded={menu} title="Demo clock">
          <Icon name="clock" size={16} />
          <span className="hide-sm">{date}</span>
          <span>{clock(s.now)}</span>
          <span className="shift hide-sm">{shift.label}</span>
        </button>
        {menu && <DemoMenu onClose={() => setMenu(false)} />}
      </div>
      {me && (
        <button className="me-chip" onClick={lock} title="Lock the tablet and switch user">
          <Avatar id={me.id} name={me.name} size={34} />
          <span className="who hide-sm"><b>{me.name}</b><span>{me.role} · Lock</span></span>
          <Icon name="lock" size={16} className="muted" />
        </button>
      )}
    </header>
  )
}

function DemoMenu({ onClose }: { onClose: () => void }) {
  const { act, api, refresh, toast } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h))
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const jump = async (m: number) => {
    await act('demo.advance', { minutes: m })
    toast(`Clock moved forward ${m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}.`, 'info')
    onClose()
  }
  return (
    <div className="demo-menu" ref={ref}>
      <div className="eyebrow" style={{ padding: '6px 12px' }}>Demo clock</div>
      <button onClick={() => jump(15)}><Icon name="fwd" />Jump 15 minutes</button>
      <button onClick={() => jump(60)}><Icon name="fwd" />Jump 1 hour</button>
      <button onClick={() => jump(240)}><Icon name="fwd" />Jump 4 hours</button>
      <div className="sep" />
      <button onClick={async () => { await api.reset(); await refresh(); toast('Demo reset to 08:12 this morning.', 'info'); onClose() }}><Icon name="reset" />Reset demo data</button>
    </div>
  )
}

function Lock() {
  const { s, signIn, go, wards, setWard } = useApp()
  const [who, setWho] = useState<Staff | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const shift = shiftNow(s.now)
  const onShift = s.staff.filter((x) => x.shift === shift.id || x.role === 'NM')
  const others = s.staff.filter((x) => !onShift.includes(x) && ['RN', 'EN', 'CA'].includes(x.role))
  const slot = currentSlot(s)
  const prog = roundProgress(s, slot)
  const open = activeAlerts(s).filter((a) => a.status === 'open').length
  const date = dateOf(s.day).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return (
    <div className="lock">
      <section className="lock-brand">
        <div className="row" style={{ gap: 12 }}>
          <Logo size={44} />
          <div>
            <div style={{ fontWeight: 750, color: '#fff', fontSize: 17 }}>HIXOR Care</div>
            <div style={{ fontSize: 13 }}>{s.home.name}</div>
          </div>
        </div>
        <div style={{ marginTop: 'auto' }}>
          <div className="big-time">{clock(s.now)}</div>
          <div style={{ marginTop: 8 }}>{date} · {shift.label}</div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <h1>{s.ward.name}<br />ward tablet</h1>
          {wards.length > 1 && (
            <div className="lock-wards" role="group" aria-label="Ward on this tablet">
              <span>{s.ward.unit} ·</span>
              {wards.map((w) => <button key={w.id} aria-pressed={w.id === s.ward.id} onClick={() => { setWho(null); setWard(w.id) }}>{w.name}</button>)}
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="stat"><Icon name="pill" size={20} /><span><b>{prog.done} of {prog.total}</b> doses done in the {slot} round</span></div>
          <div className="stat"><Icon name="bell" size={20} /><span><b>{open}</b> alert{open === 1 ? '' : 's'} waiting</span></div>
          <div className="stat"><Icon name="bed" size={20} /><span><b>{s.residents.filter((r) => r.status === 'in').length}</b> residents in, {s.residents.filter((r) => r.status !== 'in').length} in hospital</span></div>
        </div>
      </section>
      <section className="lock-pane">
        {!who ? (
          <>
            <div>
              <h2 style={{ fontSize: 24 }}>Who is using this tablet?</h2>
              <p className="muted" style={{ marginTop: 4 }}>Tap your name, then enter your PIN. The tablet locks itself after 2 minutes without use.</p>
            </div>
            <div className="eyebrow">On shift now</div>
            <div className="who-grid">
              {onShift.map((x) => <WhoCard key={x.id} x={x} onPick={() => { setErr(null); setWho(x) }} />)}
            </div>
            <div className="eyebrow">Other ward staff</div>
            <div className="who-grid">
              {others.map((x) => <WhoCard key={x.id} x={x} onPick={() => { setErr(null); setWho(x) }} />)}
            </div>
          </>
        ) : (
          <div className="stack fade-in" style={{ alignItems: 'center', gap: 18 }}>
            <Avatar id={who.id} name={who.name} size={72} />
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: 22 }}>{who.name}</h2>
              <div className="muted">{who.title}</div>
            </div>
            <PinPad
              error={err}
              onDone={async (pin) => {
                const res = await signIn(who.id, pin)
                if (!res.ok) setErr(res.message)
                else if (who.role === 'NM') go({ view: 'manager' })
              }}
            />
            <button className="btn ghost" onClick={() => setWho(null)}><Icon name="left" />Not you?</button>
          </div>
        )}
      </section>
    </div>
  )
}

function WhoCard({ x, onPick }: { x: Staff; onPick: () => void }) {
  return (
    <button className="who-card" onClick={onPick}>
      <Avatar id={x.id} name={x.name} size={52} />
      <b>{x.name}</b>
      <span>{x.title}</span>
    </button>
  )
}
