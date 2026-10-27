/**
 * Host half of the session shelf.
 *
 * It contributes one HTTP prefix route to the harness web server and nothing
 * else: no new services, no global state RPC, no patched internals. The browser
 * half reads the same-origin JSON API and performs archive/favourite changes
 * through the harness' own client services.
 */
import { createServer } from 'node:http'
import {
  invalidateShelfCache,
  listCachedSessionIds,
  listStoredSessionIds,
  purgeSessions,
  pruneOrphanIds,
  readShelfCached,
  repairProjections,
  resolveHome,
} from './shelf.js'

export const name = 'session-shelf'
export const inject = ['webServer']

const API_PREFIX = '/api/session-shelf'
const VERSION = '0.1.0'
const MAX_BODY_BYTES = 256 * 1024
const MAX_REPORTS = 40

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body-too-large'), { code: 'body-too-large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const text = await readBody(req)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('invalid-json'), { code: 'invalid-json' })
  }
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Peek into the live harness registries when the host exposes them. The sidebar
 * renders from these in-memory structures, which is why a file-level purge can
 * leave a row behind; comparing them with the on-disk view shows that drift.
 */
function readLiveState(ctx) {
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
    const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
    const workspaces = registry ? registry.list() : null
    const ids = workspaces ? workspaces.flatMap((item) => Array.from(item.sessionIds ?? [])) : null
    return {
      registryWorkspaces: workspaces ? workspaces.length : null,
      registrySessions: ids ? ids.length : null,
      sessionIds: ids ? ids.slice(0, 40) : null,
      memorySessions: store ? store.list().length : null,
    }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

/**
 * Rows whose durable artifacts are gone while the harness still holds their
 * identity in memory. Two flavors exist, and both can be detached live:
 *  - `live`: `ctx.sessions` still owns the Session object (its log was deleted
 *    underneath it), which is why the sidebar keeps rendering it;
 *  - `registry-only`: `workspaceRegistry` still accounts for the id.
 * A genuinely brand-new session has no artifact yet by design, so blank or
 * very recent live sessions are never reported.
 */
const GHOST_GRACE_MS = 5 * 60 * 1000

async function collectGhosts(ctx, home) {
  const get = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
  const registry = get('workspaceRegistry')
  if (!registry) return { ghosts: [], detail: [], unavailable: true }
  const store = get('sessions')
  const stored = new Set(await listStoredSessionIds(home, { fresh: true }))
  const cached = new Set(await listCachedSessionIds(home))
  const live = new Map()
  if (store && typeof store.list === 'function') {
    for (const session of store.list()) live.set(String(session.id), session)
  }
  const seen = new Set()
  const detail = []
  const consider = (id, workspaceId) => {
    if (seen.has(id)) return
    seen.add(id)
    if (stored.has(id) || cached.has(id)) return
    const session = live.get(id)
    if (session) {
      const createdAt = Number(session.header?.createdAt ?? 0)
      if (createdAt > 0 && Date.now() - createdAt < GHOST_GRACE_MS) return
    }
    detail.push({ id, live: session !== undefined, workspaceId: workspaceId ?? null })
  }
  for (const workspace of registry.list()) {
    for (const raw of Array.from(workspace.sessionIds ?? [])) consider(String(raw), String(workspace.id))
  }
  for (const id of live.keys()) consider(id, null)
  return { ghosts: detail.map((item) => item.id), detail, unavailable: false }
}

/** Remove one live Session object from the store; clients drop the row on disposal. */
export async function detachLiveSession(ctx, id, { flush = false } = {}) {
  const store = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  if (!store || typeof store.get !== 'function') return false
  const session = store.get(id)
  if (!session) return false
  if (flush && typeof store.flush === 'function') {
    // Persist buffered events first so a later log removal cannot lose them.
    try {
      await store.flush(session)
    } catch {
      /* the persistence handle may already be gone */
    }
  }
  try {
    const entry = typeof store.liveEntryFor === 'function' ? store.liveEntryFor(session) : undefined
    if (entry === undefined || typeof store.detachEntered !== 'function') return false
    store.detachEntered(entry)
    return true
  } catch {
    return false
  }
}

/** Tell every connected client that one Session identity no longer exists. */
export function publishRemoval(ctx, id) {
  try {
    ctx.emit('api-session/removed', id)
  } catch {
    /* clients may be disconnected; the removal is already durable */
  }
}

/**
 * Drop one identity from the live workspace accounting (membership, pin and
 * archive set). Going through the registry API keeps the in-memory domain, the
 * durable table and every connected follow stream in agreement; rewriting the
 * storage file behind the domain's back would be undone by its next flush.
 */
export async function detachRegistryAccounts(ctx, id) {
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
  if (!registry) return false
  let handled = false
  for (const workspace of registry.list()) {
    if (!Array.from(workspace.sessionIds ?? []).some((value) => String(value) === id)) continue
    try {
      await workspace.detachSession(id)
      handled = true
    } catch {
      /* membership may already be gone */
    }
  }
  for (const method of ['unarchiveSession', 'unpinSession']) {
    try {
      if (typeof registry[method] === 'function') {
        await registry[method](id)
        handled = true
      }
    } catch {
      /* the identity was not archived/pinned */
    }
  }
  return handled
}

/** Ask the harness to forget ghost ids; the sidebar follows the removal event. */
async function detachGhosts(ctx, home) {
  const { detail, unavailable } = await collectGhosts(ctx, home)
  const result = { detached: [], live: [], failed: [], unavailable }
  if (unavailable || detail.length === 0) return result
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
  for (const item of detail) {
    const id = item.id
    let handled = false
    if (item.live && (await detachLiveSession(ctx, id))) {
      handled = true
      result.live.push(id)
    }
    if (registry) {
      for (const workspace of registry.list()) {
        const raw = Array.from(workspace.sessionIds ?? []).find((value) => String(value) === id)
        if (raw === undefined) continue
        try {
          await workspace.detachSession(raw)
          handled = true
        } catch (error) {
          result.failed.push({ id, reason: errorMessage(error) })
        }
      }
    }
    publishRemoval(ctx, id)
    if (handled) result.detached.push(id)
  }
  if (result.detached.length > 0) invalidateShelfCache()
  return result
}

/** Keep a small in-memory notebook of browser-side reports for diagnostics. */function createReportBook() {
  const reports = []
  const record = (entry) => {
    reports.push({ at: Date.now(), ...entry })
    while (reports.length > MAX_REPORTS) reports.shift()
  }
  return {
    record,
    snapshot: () => reports.slice(),
  }
}

export function apply(ctx) {
  const home = resolveHome()
  const startedAt = Date.now()
  const reports = createReportBook()
  const stats = { requests: 0, errors: 0, purges: 0, prunes: 0, repairs: 0 }
  let lastError = null

  const handle = async (req, res, pathname, query) => {
    const method = (req.method || 'GET').toUpperCase()
    const route = pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/'

    if (route === '/state') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' })
      const scopeRaw = query.get('scope') ?? 'both'
      const scope = ['both', 'archived', 'pinned', 'all'].includes(scopeRaw) ? scopeRaw : 'both'
      const data = await readShelfCached(home, { scope, fresh: query.get('fresh') === '1' })
      const { ghosts, detail, unavailable } = await collectGhosts(ctx, home)
      return sendJson(res, 200, { ...data, ghosts, ghostDetail: detail, ghostsUnavailable: unavailable })
    }

    if (route === '/diagnostics') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' })
      const live = readLiveState(ctx)
      return sendJson(res, 200, {
        version: VERSION,
        home,
        node: process.version,
        startedAt,
        uptimeMs: Date.now() - startedAt,
        requests: stats.requests,
        errors: stats.errors,
        purges: stats.purges,
        prunes: stats.prunes,
        repairs: stats.repairs,
        lastError,
        live,
        clientReports: reports.snapshot(),
      })
    }

    if (route === '/client-report') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      let body = {}
      try {
        body = await readJsonBody(req)
      } catch {
        /* a malformed report is still a report */
      }
      reports.record({
        stage: typeof body?.stage === 'string' ? body.stage.slice(0, 64) : 'unknown',
        message: typeof body?.message === 'string' ? body.message.slice(0, 2000) : null,
        detail: body?.detail ?? null,
      })
      return sendJson(res, 200, { ok: true })
    }

    if (route === '/purge') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      const body = await readJsonBody(req)
      const ids = Array.isArray(body?.ids) ? body.ids : []
      if (ids.length === 0) return sendJson(res, 400, { error: 'no-ids' })
      const result = await purgeSessions(home, ids, { force: body?.force === true, mutateRegistry: false })
      // A file-level purge cannot clear rows the harness keeps in memory, so drop
      // every accepted identity from the live store and the live workspace
      // accounting, then announce the removal. Ids the purge rejected (malformed)
      // are left untouched: acting on them would hide a Session that still exists.
      const accepted = (result.removed ?? [])
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter((id) => typeof id === 'string' && id.length > 0)
      const detached = []
      for (const raw of accepted) {
        const detachedNow = await detachLiveSession(ctx, raw)
        if (detachedNow) detached.push(raw)
        // Announce before touching the archive/pin sets: the client drops the row
        // on this event, and a later un-archive frame then has nothing to reveal.
        publishRemoval(ctx, raw)
        await detachRegistryAccounts(ctx, raw)
      }
      stats.purges += 1
      return sendJson(res, 200, { ...result, detached })
    }

    if (route === '/repair-projection') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      const body = await readJsonBody(req)
      const ids = Array.isArray(body?.ids) ? body.ids : []
      if (ids.length === 0) return sendJson(res, 400, { error: 'no-ids' })
      const result = await repairProjections(home, ids)
      stats.repairs += 1
      return sendJson(res, 200, result)
    }

    if (route === '/detach-ghosts') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      const result = await detachGhosts(ctx, home)
      if (result.detached.length > 0) stats.prunes += 1
      return sendJson(res, 200, result)
    }

    if (route === '/prune-orphans') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      const result = await pruneOrphanIds(home)
      stats.prunes += 1
      return sendJson(res, 200, result)
    }

    if (route === '/reset-cache') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
      invalidateShelfCache()
      return sendJson(res, 200, { ok: true })
    }

    return sendJson(res, 404, { error: 'not-found', route })
  }

  const handler = (req, res) => {
    stats.requests += 1
    let url
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      return sendJson(res, 400, { error: 'bad-url' })
    }
    handle(req, res, url.pathname, url.searchParams).catch((error) => {
      stats.errors += 1
      lastError = { at: Date.now(), message: errorMessage(error) }
      if (res.headersSent) {
        res.end()
        return
      }
      const code = error?.code === 'body-too-large' || error?.code === 'invalid-json' ? 400 : 500
      sendJson(res, code, { error: errorMessage(error) })
    })
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
    return () => {
      dispose()
    }
  }, 'session-shelf: http api')
}

/** Exposed for a plain-node smoke script; not part of the plugin contract. */
export function createShelfServer({ home = resolveHome() } = {}) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/'
    if (route !== '/state') {
      sendJson(res, 404, { error: 'not-found', route })
      return
    }
    readShelfCached(home, { scope: url.searchParams.get('scope') ?? 'both' })
      .then((data) => sendJson(res, 200, data))
      .catch((error) => sendJson(res, 500, { error: errorMessage(error) }))
  })
}

