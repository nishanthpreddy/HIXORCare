import { initialState, runAction, tick, type EngineState } from './engine'
import type { ActionResult, Snapshot } from '../domain/types'

/** One interface, two backends: the FastAPI server, or the in-browser demo engine. */
export interface Api {
  mode: 'server' | 'demo'
  snapshot(): Promise<Snapshot>
  act<T = unknown>(actorId: string, action: string, body?: Record<string, unknown>): Promise<ActionResult<T>>
  signIn(staffId: string, pin: string): Promise<ActionResult>
  reset(): Promise<void>
}

const STORE_KEY = 'hixor-care-demo-v3'

class DemoApi implements Api {
  mode = 'demo' as const
  private st: EngineState

  constructor() {
    this.st = this.load() ?? initialState()
  }

  private load(): EngineState | null {
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (!raw) return null
      const st = JSON.parse(raw) as EngineState
      // A stored demo from an earlier day starts fresh.
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
      return st.snap.day === today ? st : null
    } catch {
      return null
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.st))
    } catch {
      /* storage unavailable: the demo still works for this visit */
    }
  }

  async snapshot() {
    tick(this.st)
    return structuredClone(this.st.snap)
  }

  async act<T>(actorId: string, action: string, body: Record<string, unknown> = {}) {
    const res = runAction(this.st, actorId, action, body)
    this.save()
    return res as ActionResult<T>
  }

  async signIn(staffId: string, pin: string) {
    return runAction(this.st, staffId, 'auth.check', { staffId, pin })
  }

  async reset() {
    this.st = initialState()
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

  snapshot(): Promise<Snapshot> {
    return this.call('/wards/w-2b/snapshot')
  }

  async signIn(staffId: string, pin: string): Promise<ActionResult> {
    const res = await this.call('/auth/sign-in', { method: 'POST', body: JSON.stringify({ staffId, pin }) })
    if (res.ok) this.tokens.set(staffId, res.data.token)
    return res
  }

  act<T>(actorId: string, action: string, body: Record<string, unknown> = {}): Promise<ActionResult<T>> {
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
