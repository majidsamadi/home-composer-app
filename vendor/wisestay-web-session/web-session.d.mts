export const CONTRACT: string
export const ACCOUNT_ORIGIN: string
export const APPLICATIONS: Readonly<Record<string, string>>
export interface Receipt {
  contract: string
  csrf: string
  authenticated: boolean
  user_id?: string
  identity_contract?: string
  expires_at?: number
}
export class WebSessionError extends Error {
  status: number
  code: string
  uncertain: boolean
  constructor(status: number, code: string, uncertain?: boolean)
}
export function safeReturnPath(value: unknown, fallback?: string): string
export function routeReturnPath(
  to: { path?: unknown; fullPath?: unknown; query?: unknown },
  options?: { loginPaths?: string[]; hashRouter?: boolean },
): string
export function authorizationUrl(value: unknown): string
export class WebSession {
  constructor(options: {
    application: string
    origin?: string
    fetch?: typeof fetch
    navigate?: (url: string) => void
    storage?: Storage
    locks?: LockManager
    enabled?: boolean
  })
  readonly application: string
  readonly base: string
  readonly enabled: boolean
  readonly authenticated: boolean
  readonly userId: string | null
  isCurrent(receipt: Receipt | null): boolean
  receipt: Receipt | null
  blocked: boolean
  clear(): void
  forget(): void
  destination(path: string): string
  restore(force?: boolean): Promise<Receipt | null>
  start(path?: string, options?: { switchAccount?: boolean; restart?: boolean }): Promise<void>
  logout(): Promise<void>
  fetch(path: string, init?: RequestInit, service?: string): Promise<Response>
}
export function installGuard(
  router: any,
  session: WebSession,
  options?: {
    admit?: (receipt: Receipt) => Promise<void>
    loginPaths?: string[]
    hashRouter?: boolean
  },
): void
