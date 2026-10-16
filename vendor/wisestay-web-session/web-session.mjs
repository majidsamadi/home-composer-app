/** WiseStay browser session client. Canonical source: user-management-backend/clients/web-session.
 * Provider credentials stay behind the same-origin backend. This module has no framework dependency.
 */
export const CONTRACT = 'wisestay.web-session.v1'
export const ACCOUNT_ORIGIN = 'https://user.wizestay.com'
export const APPLICATIONS = Object.freeze({
  owner: 'https://owner.wizestay.com',
  tenant: 'https://tenant.wizestay.com',
  iot: 'https://iot.wizestay.com',
  'service-manager': 'https://service-manager.wizestay.com',
  ota: 'https://ota.wizestay.com',
  admin: 'https://admin.wizestay.com',
  resvanta: 'https://resvanta.wizestay.com',
  'main-mobile': 'https://main-mobile.dev.wizestay.com',
  'iot-mobile': 'https://mobile.dev.wizestay.com',
})
const SERVICES = {
  owner: ['core'],
  tenant: ['core'],
  iot: ['iot'],
  'service-manager': ['core'],
  ota: ['core'],
  admin: ['core', 'iot'],
  resvanta: ['resvanta'],
  'main-mobile': ['core', 'iot'],
  'iot-mobile': ['core', 'iot'],
}
const RECOVERY = new Set(['/auth/error', '/signed-out'])
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
export class WebSessionError extends Error {
  constructor(status, code, uncertain = false) {
    super(
      status === 401
        ? 'Your session has ended. Sign in again to continue.'
        : 'Your WiseStay session could not be verified. Please try again.',
    )
    this.status = status
    this.code = code
    this.uncertain = uncertain
  }
}
function invalid() {
  throw new WebSessionError(502, 'invalid_session_response')
}
export function safeReturnPath(value, fallback = '/') {
  if (typeof value !== 'string' || !value || value.length > 2048) return fallback
  try {
    let decoded = value
    for (let round = 0; round < 4; round++) {
      if (
        !decoded.startsWith('/') ||
        decoded.startsWith('//') ||
        /[\\\u0000-\u001f\u007f]/.test(decoded)
      )
        return fallback
      const next = decodeURIComponent(decoded.replace(/%(?![a-f0-9]{2})/gi, '%25'))
      if (next === decoded) break
      decoded = next
    }
    const rawPath = decoded.split(/[?#]/, 1)[0]
    if (
      rawPath.includes('%') ||
      rawPath.includes('//') ||
      rawPath.split('/').some((part) => part === '.' || part === '..')
    )
      return fallback
    const parsed = new URL(decoded, 'https://local.invalid')
    if (
      parsed.origin !== 'https://local.invalid' ||
      /^\/(?:api|auth|authorize)/i.test(parsed.pathname) ||
      /^\/(?:login|sign-in|register|logout|signed-out)\/?$/i.test(parsed.pathname)
    )
      return fallback
    for (const key of parsed.searchParams.keys())
      if (/^(?:access_token|refresh_token|id_token|authorization|cookie|code|state)$/i.test(key))
        return fallback
    if (
      /^#(?:access_token|refresh_token|id_token|authorization|cookie|code|state)(?:=|$)/i.test(
        parsed.hash,
      )
    )
      return fallback
    if (/proof|token|secret|credential|authorization|password/i.test(parsed.hash))
      return value.split('#')[0]
    // Keep the original encoded path, query and page anchor, without URL normalization.
    return value
  } catch {
    return fallback
  }
}
/** Derive an application-owned local destination from router state only.
 * Display labels, route names, params and caller metadata are never redirect authority.
 */
export function routeReturnPath(
  to,
  { loginPaths = ['/login', '/sign-in'], hashRouter = false } = {},
) {
  if (!object(to) || typeof to.path !== 'string') return '/'
  const fullPath = typeof to.fullPath === 'string' ? to.fullPath : to.path
  if (loginPaths.includes(to.path)) {
    const query = object(to.query) ? to.query : {}
    return safeReturnPath(query.returnTo)
  }
  return safeReturnPath(hashRouter ? '/#' + fullPath : fullPath)
}

export function authorizationUrl(value) {
  if (typeof value !== 'string') return invalid()
  const url = new URL(value)
  if (
    url.origin !== ACCOUNT_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/authorize' ||
    [...url.searchParams].length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('request') || '')
  )
    return invalid()
  return url.href
}
async function json(response) {
  if (
    !/^(?:application\/json|application\/problem\+json)(?:;|$)/i.test(
      response.headers.get('content-type') || '',
    )
  )
    return invalid()
  const reader = response.body?.getReader()
  if (!reader) return invalid()
  let size = 0,
    output = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 24000) return invalid()
      output += decoder.decode(item.value, { stream: true })
    }
    return JSON.parse(output + decoder.decode())
  } finally {
    await reader.cancel().catch(() => {})
  }
}
export class WebSession {
  constructor({
    application,
    origin = globalThis.location?.origin,
    fetch: transport,
    navigate,
    storage,
    locks,
    enabled = true,
  }) {
    if (!Object.hasOwn(APPLICATIONS, application))
      throw new Error('Unregistered WiseStay application')
    this.application = application
    this.base = '/api/v1/web-session/' + application
    this.enabled = enabled && origin === APPLICATIONS[application]
    this.transport = transport || ((...args) => globalThis.fetch(...args))
    this.navigate = navigate || ((url) => globalThis.location.assign(url))
    this.storage = storage
    this.locks = locks
    this.receipt = null
    this.csrf = ''
    this.epoch = 0
    this.flight = null
    this.loginFlight = null
    this.key = 'ws.web.' + application + '.return.v1'
    this.blocked = false
  }
  get authenticated() {
    return (
      this.receipt?.authenticated === true &&
      this.receipt.expires_at * 1000 > Date.now() &&
      !this.blocked
    )
  }
  get userId() {
    return this.authenticated ? this.receipt.user_id : null
  }
  /** Process-local session currentness only; never an application/resource grant. */
  isCurrent(receipt) {
    return receipt === this.receipt && this.authenticated
  }
  clear() {
    this.epoch++
    this.receipt = null
    this.csrf = ''
    this.flight = null
  }
  assert(epoch) {
    if (epoch !== this.epoch) throw new WebSessionError(401, 'session_changed')
  }
  saved() {
    try {
      return JSON.parse((this.storage || globalThis.sessionStorage)?.getItem(this.key) || 'null')
    } catch {
      return null
    }
  }
  remember(path) {
    try {
      ;(this.storage || globalThis.sessionStorage)?.setItem(
        this.key,
        JSON.stringify({ path, at: Date.now() }),
      )
    } catch {}
  }
  forget() {
    try {
      ;(this.storage || globalThis.sessionStorage)?.removeItem(this.key)
    } catch {}
  }
  destination(path) {
    const saved = this.saved()
    return path === '/' &&
      saved &&
      Number.isFinite(saved.at) &&
      Date.now() >= saved.at &&
      Date.now() - saved.at < 3600000
      ? safeReturnPath(saved.path)
      : safeReturnPath(path)
  }
  async locked(work) {
    const locks = this.locks || globalThis.navigator?.locks
    if (!locks?.request) throw new WebSessionError(503, 'browser_unsupported')
    return locks.request('wisestay.' + this.application + '.web-session', work)
  }
  async send(operation, body, csrf = '', method = 'POST', signal) {
    const headers = { Accept: 'application/json', 'X-WiseStay-Web-Session': CONTRACT }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (csrf) headers['X-CSRF-Token'] = csrf
    try {
      const response = await this.transport(this.base + '/' + operation, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      })
      const value = await json(response)
      if (!response.ok)
        throw new WebSessionError(
          response.status,
          object(value?.error) && /^[a-z0-9_]{1,100}$/.test(value.error.code)
            ? value.error.code
            : 'session_unavailable',
          method !== 'GET' && response.status >= 500,
        )
      return value
    } catch (error) {
      if (error instanceof WebSessionError) throw error
      throw new WebSessionError(0, 'network_uncertain', method !== 'GET')
    }
  }
  async read(epoch) {
    for (let attempt = 0; ; attempt++) {
      try {
        const ready = await this.send('readiness', undefined, '', 'GET')
        this.assert(epoch)
        if (!object(ready) || ready.contract !== CONTRACT || ready.ready !== true) return invalid()
        break
      } catch (error) {
        this.assert(epoch)
        if (
          !(error instanceof WebSessionError) ||
          ![0, 502, 503, 504].includes(error.status) ||
          attempt >= 2
        )
          throw error
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
    const value = await this.send('bootstrap', {})
    this.assert(epoch)
    if (
      !object(value) ||
      value.contract !== CONTRACT ||
      typeof value.authenticated !== 'boolean' ||
      typeof value.csrf !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.csrf)
    )
      return invalid()
    const fields = value.authenticated
      ? ['contract', 'authenticated', 'csrf', 'user_id', 'identity_contract', 'expires_at']
      : ['contract', 'authenticated', 'csrf']
    if (
      Object.keys(value).length !== fields.length ||
      Object.keys(value).some((key) => !fields.includes(key))
    )
      return invalid()
    if (
      value.authenticated &&
      (value.identity_contract !== 'wisestay.identity.v1' ||
        typeof value.user_id !== 'string' ||
        !value.user_id ||
        !Number.isSafeInteger(value.expires_at) ||
        value.expires_at * 1000 <= Date.now())
    )
      return invalid()
    if (
      this.receipt?.authenticated &&
      value.authenticated &&
      this.receipt.user_id !== value.user_id
    ) {
      // A return path captured under the previous canonical person must never
      // survive an identity transition into a later account.
      this.forget()
      this.clear()
      throw new WebSessionError(401, 'identity_changed')
    }
    this.csrf = value.csrf
    this.receipt = value
    return value
  }
  restore(force = false) {
    if (!this.enabled || this.blocked) return Promise.resolve(null)
    if (this.flight) return this.flight
    if (!force && this.authenticated) return Promise.resolve(this.receipt)
    const epoch = this.epoch,
      flight = this.locked(() => {
        this.assert(epoch)
        return this.read(epoch)
      })
    this.flight = flight
    void flight
      .finally(() => {
        if (this.flight === flight) this.flight = null
      })
      .catch(() => {})
    return flight
  }
  start(path = '/', { switchAccount = false, restart = false } = {}) {
    if (this.loginFlight) return this.loginFlight
    const flight = this.locked(async () => {
      this.blocked = false
      const epoch = this.epoch
      let receipt = await this.read(epoch)
      if (switchAccount || (restart && !receipt.authenticated)) {
        await this.send('logout', {}, this.csrf)
        this.assert(epoch)
        this.receipt = null
        this.csrf = ''
        receipt = await this.read(epoch)
      }
      const destination = this.destination(safeReturnPath(path))
      if (receipt.authenticated) {
        this.forget()
        this.navigate(destination)
        return
      }
      this.remember(destination)
      const result = await this.send(
        'start',
        { return_to: destination, switch_account: switchAccount },
        this.csrf,
      )
      this.assert(epoch)
      if (!object(result) || Object.keys(result).length !== 1) return invalid()
      this.navigate(authorizationUrl(result.authorization_url))
    })
    this.loginFlight = flight
    void flight
      .finally(() => {
        if (this.loginFlight === flight) this.loginFlight = null
      })
      .catch(() => {})
    return flight
  }
  async logout() {
    const proof = this.csrf
    this.clear()
    this.blocked = true
    this.forget()
    this.notifySignedOut?.()
    await this.locked(async () => {
      const result = await this.send('logout', {}, proof)
      if (
        !object(result) ||
        result.state !== 'signed_out' ||
        result.scope !== 'this_website' ||
        result.other_application_sessions_revoked !== false
      )
        return invalid()
    })
  }
  async fetch(path, init = {}, service = 'core') {
    if (!SERVICES[this.application].includes(service) || !this.authenticated || !this.csrf)
      throw new WebSessionError(401, 'session_required')
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.length > 6144 ||
      /[\\#\u0000-\u001f\u007f]/.test(path) ||
      /%2f|%5c/i.test(path.split('?')[0]) ||
      decodeURIComponent(path.split('?')[0])
        .split('/')
        .some((part) => part === '.' || part === '..')
    )
      throw new WebSessionError(400, 'unsafe_api_path')
    const headers = new Headers(init.headers)
    headers.delete('Authorization')
    headers.delete('Cookie')
    headers.set('X-WiseStay-Web-Session', CONTRACT)
    headers.set('X-CSRF-Token', this.csrf)
    const epoch = this.epoch
    const response = await this.transport(this.base + '/api/' + service + path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
    this.assert(epoch)
    if (response.status === 401) this.clear()
    return response
  }
}
/** Install before app guards. Only browser deployments at exact registered origins participate. */
export function installGuard(
  router,
  session,
  { admit = async () => {}, loginPaths = ['/login', '/sign-in'], hashRouter = false } = {},
) {
  if (!session.enabled) return
  const reveal = () => {
    const root = globalThis.document?.getElementById('app')
    if (root) root.hidden = false
  }
  const hide = () => {
    const root = globalThis.document?.getElementById('app')
    if (root) root.hidden = true
  }
  globalThis.addEventListener?.('pagehide', hide)
  globalThis.addEventListener?.('pageshow', (event) => {
    if (event.persisted) globalThis.location.reload()
  })
  if (
    typeof globalThis.window !== 'undefined' &&
    typeof globalThis.BroadcastChannel !== 'undefined'
  ) {
    const channel = new BroadcastChannel('wisestay.' + session.application + '.web-session')
    session.notifySignedOut = () => channel.postMessage('signed-out')
    channel.onmessage = (event) => {
      if (event.data === 'signed-out') {
        hide()
        session.forget()
        session.clear()
        session.blocked = true
        session.navigate('/signed-out')
      }
    }
  }
  let navigation = 0
  router.beforeEach(async (to) => {
    const own = ++navigation
    const isLatestNavigation = () => own === navigation
    if (RECOVERY.has(to.path)) {
      reveal()
      return true
    }
    // Protected content stays hidden until both current identity and app-owned
    // admission have succeeded. Redirect/error URLs never carry private intent.
    hide()
    if (to.path.startsWith('/auth/')) return { path: '/auth/error' }
    const destination = routeReturnPath(to, { loginPaths, hashRouter })
    try {
      const receipt = await session.restore()
      if (!isLatestNavigation()) return false
      if (!receipt?.authenticated) {
        if (session.blocked) {
          session.forget()
          return { path: '/signed-out' }
        }
        await session.start(destination)
        return false
      }
      // The login handoff is complete. Keep the intended destination only in
      // this guard invocation; a later account/error must not inherit it.
      session.forget()
      await admit(receipt)
      // Admission is advisory application work, not a grant. It is useful only
      // while the exact local session receipt and this navigation remain current.
      if (!isLatestNavigation()) return false
      if (!session.isCurrent(receipt)) throw new WebSessionError(401, 'session_changed')
      reveal()
      return loginPaths.includes(to.path) ? (hashRouter ? destination.slice(2) : destination) : true
    } catch (error) {
      // A newer navigation owns the UI now; an older guard must not redirect,
      // reveal, forget or otherwise restore its previous private destination.
      if (!isLatestNavigation()) return false
      if (
        error instanceof WebSessionError &&
        (error.status === 401 ||
          ['identity_changed', 'session_changed', 'web_login_cancelled'].includes(error.code))
      )
        session.forget()
      return { path: '/auth/error' }
    }
  })
}
