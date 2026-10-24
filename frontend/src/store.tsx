import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createApi, type Api } from './api/client'
import type { ActionResult, Snapshot, Staff, Ward } from './domain/types'

export type View = 'manager' | 'incidents' | 'today' | 'round' | 'residents' | 'resident' | 'handover' | 'alerts' | 'audit'
export interface Route { view: View; rid?: string; tab?: string }
export interface Toast { id: number; text: string; tone: 'ok' | 'critical' | 'info' }
type Theme = 'system' | 'light' | 'dark'

interface Ctx {
  api: Api
  s: Snapshot
  /** Wards in the home. The tablet shows one at a time; a nurse manager can switch between the wards they cover. */
  wards: Ward[]
  setWard: (id: string) => void
  me: Staff | null
  signIn: (staffId: string, pin: string) => Promise<ActionResult>
  lock: () => void
  act: <T = any>(action: string, body?: Record<string, unknown>, opts?: { success?: string; quiet?: boolean }) => Promise<ActionResult<T>>
  refresh: () => Promise<void>
  route: Route
  go: (r: Route) => void
  toast: (text: string, tone?: Toast['tone']) => void
  toasts: Toast[]
  theme: Theme
  setTheme: (t: Theme) => void
  staff: (id?: string | null) => Staff | undefined
}

const AppCtx = createContext<Ctx | null>(null)

export const useApp = () => {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

function routeFromHash(): Route {
  const h = location.hash.replace('#', '')
  if (h.startsWith('res-')) return { view: 'resident', rid: 'r-' + h.slice(4) }
  if (['manager', 'incidents', 'today', 'round', 'residents', 'handover', 'alerts', 'audit'].includes(h)) return { view: h as View }
  return { view: 'today' }
}

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* ignore */ }
}

export function AppProvider({ children }: { children: (ready: boolean) => ReactNode }) {
  const api = useMemo(() => createApi(), [])
  const [s, setS] = useState<Snapshot | null>(null)
  const [wards, setWards] = useState<Ward[]>([])
  const [wardId, setWardId] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(() => (api.mode === 'demo' ? read('hixor-me') : null))
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [theme, setThemeState] = useState<Theme>(() => (read('hixor-theme') as Theme) || 'system')
  const tid = useRef(0)

  useEffect(() => {
    api.wards().then((ws) => {
      setWards(ws)
      const saved = read('hixor-ward')
      setWardId(ws.some((w) => w.id === saved) ? saved : ws[0].id)
    })
  }, [api])

  const refresh = useCallback(async () => {
    if (wardId) setS(await api.snapshot(wardId))
  }, [api, wardId])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  const setWard = useCallback((id: string) => {
    setWardId(id)
    write('hixor-ward', id)
    // A resident page belongs to the ward it was opened from.
    setRoute((r) => (r.view === 'resident' ? { view: 'residents' } : r))
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    write('hixor-theme', theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++tid.current
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'critical' ? 6000 : 3200)
  }, [])

  const go = useCallback((r: Route) => {
    setRoute(r)
    const token = r.view === 'resident' && r.rid ? `res-${r.rid.slice(2)}` : r.view
    try { history.replaceState(null, '', `#${token}`) } catch { /* sandboxed */ }
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }, [])

  const act = useCallback(async (action: string, body: Record<string, unknown> = {}, opts: { success?: string; quiet?: boolean } = {}): Promise<ActionResult<any>> => {
    if (!meId) return { ok: false as const, code: 'forbidden' as const, message: 'Sign in first.' }
    const res = await api.act<any>(wardId!, meId, action, body)
    await refresh()
    if (res.ok && opts.success) toast(opts.success + (res.message ? ` ${res.message}` : ''))
    if (!res.ok && !opts.quiet) toast(res.message, 'critical')
    return res
  }, [api, wardId, meId, refresh, toast])

  const signIn = useCallback(async (staffId: string, pin: string) => {
    const res = await api.signIn(wardId!, staffId, pin)
    if (res.ok) {
      setMeId(staffId)
      if (api.mode === 'demo') write('hixor-me', staffId)
    }
    return res
  }, [api, wardId])

  const lock = useCallback(() => {
    setMeId(null)
    write('hixor-me', '')
  }, [])

  const value = useMemo<Ctx | null>(() => {
    if (!s) return null
    return {
      api, s, wards, setWard, me: s.staff.find((x) => x.id === meId) ?? null, signIn, lock, act, refresh, route, go, toast, toasts, theme, setTheme: setThemeState,
      staff: (id) => s.staff.find((x) => x.id === id),
    }
  }, [api, s, wards, setWard, meId, signIn, lock, act, refresh, route, go, toast, toasts, theme])

  if (!value) return <>{children(false)}</>
  return <AppCtx.Provider value={value}>{children(true)}</AppCtx.Provider>
}
