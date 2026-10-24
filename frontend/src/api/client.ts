import { DEMO_WARDS, initialState, runAction, tick, type EngineState } from './engine'
import type { ActionResult, Snapshot, Ward } from '../domain/types'

/** One interface, two backends: the FastAPI server, or the in-browser demo engine. Each tablet works on one ward at a time. */
export interface Api {
  mode: 'server' | 'demo'
  wards(): Promise<Ward[]>
  snapshot(wardId: string): Promise<Snapshot>
  act<T = unknown>(wardId: string, actorId: string, action: string, body?: Record<string, unknown>): Promise<ActionResult<T>>
  signIn(wardId: string, staffId: string, pin: string): Promise<ActionResult>
  reset(): Promise<void>
}

const STORE_KEY = 'hixor-care-demo-v5'
type Home = Record<string, EngineState>

class DemoApi implements Api {
  mode = 'demo' as const
  private home: Home

  constructor() {
    this.home = this.load() ?? this.fresh()
  }

  private fresh(): Home {
    return Object.fromEntries(DEMO_WARDS.map((w) => [w.id, initialState(w.id)]))
  }

  private load(): Home | null {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (!raw) return null
      const home = JSON.parse(raw) as Home
      // A stored demo from an earlier day starts fresh.
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
      return DEMO_WARDS.every((w) => home[w.id]?.snap.day === today) ? home : null
    } catch {
      return null
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.home))
    } catch {
      /* storage unavailable: the demo still works for this visit */
    }
  }

  private ward(id: string) {
    return this.home[id] ?? this.home[DEMO_WARDS[0].id]
  }

  async wards() {
    return DEMO_WARDS
  }

  async snapshot(wardId: string) {
    const st = this.ward(wardId)
    tick(st)
    return structuredClone(st.snap)
  }

  async act<T>(wardId: string, actorId: string, action: string, body: Record<string, unknown> = {}) {
    // The demo clock is the home's clock: moving it moves every ward.
    const targets = action === 'demo.advance' ? Object.values(this.home) : [this.ward(wardId)]
    let res: ActionResult = { ok: true }
    for (const st of targets) res = runAction(st, actorId, action, body)
    this.save()
    return res as ActionResult<T>
  }

  async signIn(wardId: string, staffId: string, pin: string) {
    return runAction(this.ward(wardId), staffId, 'auth.check', { staffId, pin })
  }

  async reset() {
    this.home = this.fresh()
    this.save()
  }
}

class ServerApi implements Api {
  mode = 'server' as const
  private tokens = new Map<string, string>()
  private base = '/api'

  private async call(path: string, init: RequestInit = {}, actorId?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = actorId ? this.tokens.get(actorId) : undefined
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(this.base + path, { ...init, headers })
    const renewed = res.headers.get('X-Token')
    if (renewed && actorId) this.tokens.set(actorId, renewed)
    const body = await res.json()
    // FastAPI wraps HTTPException payloads in "detail".
    return body?.detail && typeof body.detail === 'object' ? body.detail : body
  }

  wards(): Promise<Ward[]> {
    return this.call('/wards')
  }

  snapshot(wardId: string): Promise<Snapshot> {
    return this.call(`/wards/${wardId}/snapshot`)
  }

  async signIn(_wardId: string, staffId: string, pin: string): Promise<ActionResult> {
    const res = await this.call('/auth/sign-in', { method: 'POST', body: JSON.stringify({ staffId, pin }) })
    if (res.ok) this.tokens.set(staffId, res.data.token)
    return res
  }

  act<T>(_wardId: string, actorId: string, action: string, body: Record<string, unknown> = {}): Promise<ActionResult<T>> {
    if (action === 'demo.advance') return this.call('/demo/advance', { method: 'POST', body: JSON.stringify(body) })
    return this.call(`/actions/${action}`, { method: 'POST', body: JSON.stringify(body) }, actorId)
  }

  async reset() {
    await this.call('/demo/reset', { method: 'POST' })
  }
}

/** Server mode when built with VITE_API=server (or ?api=server); demo mode otherwise. */
export function createApi(): Api {
  const wantServer = import.meta.env.VITE_API === 'server' || new URLSearchParams(location.search).get('api') === 'server'
  return wantServer ? new ServerApi() : new DemoApi()
}
