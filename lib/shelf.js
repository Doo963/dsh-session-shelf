/**
 * Read-only inventory of DeepSeek Harness sessions plus the two destructive
 * maintenance operations the shelf offers (permanent purge, orphan pruning).
 *
 * Everything here works directly on the harness data directory:
 *   <home>/storages/workspace.json                  registry + archive/favourite sets
 *   <home>/storages/session_projcache/sessions/*.js* projection cache (title, cwd)
 *   <home>/sessions/<workspace-slug>/<session-id>/   session logs
 *
 * The module intentionally has no dependency on harness internals so it keeps
 * working when a release reshuffles service wiring.
 */
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const SESSION_ID_PATTERN = /^session-[A-Za-z0-9][A-Za-z0-9._-]*$/
const ACTIVE_WINDOW_MS = 120_000
const SNAPSHOT_TTL_MS = 1_500

/** Resolve the harness data directory the same way the CLI does. */
export function resolveHome(env = process.env, home = homedir()) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured ? resolve(configured) : join(home, '.dsh')
}

/** All path helpers live here so tests can point at a fixture tree. */
export function shelfPaths(home) {
  return {
    home,
    registry: join(home, 'storages', 'workspace.json'),
    projections: join(home, 'storages', 'session_projcache', 'sessions'),
    sessions: join(home, 'sessions'),
  }
}

async function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(await readFile(file, 'utf8')) }
  } catch (error) {
    const missing = error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    return { ok: false, missing, reason: missing ? 'missing' : 'unreadable', error }
  }
}

async function readDirectory(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function safeStat(file) {
  try {
    return await stat(file)
  } catch {
    return null
  }
}

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueIds(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    const id = normalizeId(entry)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Parse the durable workspace registry. A missing file just means "nothing is
 * archived yet"; a corrupt file is reported so the panel can surface it.
 */
export async function readRegistry(home) {
  const { registry } = shelfPaths(home)
  const result = await readJson(registry)
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      archivedSessionIds: [],
      pinnedSessionIds: [],
      workspaces: [],
      raw: null,
    }
  }
  const value = result.value && typeof result.value === 'object' ? result.value : {}
  const global = value.global && typeof value.global === 'object' ? value.global : {}
  const tables = value.tables && typeof value.tables === 'object' ? value.tables : {}
  const workspaceTable = tables.workspaces && typeof tables.workspaces === 'object' ? tables.workspaces : {}

  const workspaces = []
  for (const [id, row] of Object.entries(workspaceTable)) {
    if (!row || typeof row !== 'object') continue
    workspaces.push({
      id,
      path: stringOrNull(row.path),
      title: stringOrNull(row.title) || stringOrNull(row.path) || id,
      sessionIds: uniqueIds(row.sessionIds),
      createdAt: stringOrNull(row.createdAt),
      updatedAt: stringOrNull(row.updatedAt),
    })
  }

  return {
    ok: true,
    reason: null,
    archivedSessionIds: uniqueIds(global.archivedSessionIds),
    pinnedSessionIds: uniqueIds(global.pinnedSessionIds),
    workspaces,
    raw: value,
  }
}

/** Projection cache: title / cwd / creation time survive restarts, so trust it first. */
export async function readProjection(home, sessionId) {
  const { projections } = shelfPaths(home)
  const result = await readJson(join(projections, sessionId + '.json'))
  if (!result.ok) return { ok: false, reason: result.reason, title: null, cwd: null, createdAt: null }

  const record = result.value?.record && typeof result.value.record === 'object' ? result.value.record : {}
  const identity = record.identity && typeof record.identity === 'object' ? record.identity : {}
  const rows = record.rows && typeof record.rows === 'object' ? record.rows : {}

  const directTitle = stringOrNull(rows.title?.val)
  const firstPrompt = stringOrNull(rows.titleInput?.val?.first?.text)
  return {
    ok: true,
    reason: null,
    title: directTitle || null,
    prompt: firstPrompt || null,
    cwd: stringOrNull(identity.cwd),
    createdAt: numberOrNull(identity.createdAt),
    formatVersion: numberOrNull(identity.formatVersion),
  }
}

/**
 * One directory walk over <home>/sessions, memoised briefly. Requests are cheap
 * but the panel polls, so the TTL keeps repeated stats off the hot path.
 */
let logIndex = { home: null, at: 0, map: new Map() }

async function scanLogs(home, { fresh = false } = {}) {
  const now = Date.now()
  if (!fresh && logIndex.home === home && now - logIndex.at < SNAPSHOT_TTL_MS) return logIndex.map

  const { sessions } = shelfPaths(home)
  const map = new Map()
  for (const slug of await readDirectory(sessions)) {
    if (!slug.isDirectory()) continue
    const slugDir = join(sessions, slug.name)
    for (const entry of await readDirectory(slugDir)) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue
      const dir = join(slugDir, entry.name)
      const dirStat = await safeStat(dir)
      let bytes = 0
      let updatedAt = dirStat ? dirStat.mtimeMs : null
      let logName = null
      let fileCount = 0
      for (const file of await readDirectory(dir)) {
        if (!file.isFile()) continue
        fileCount += 1
        const info = await safeStat(join(dir, file.name))
        if (!info) continue
        bytes += info.size
        if (logName === null || info.mtimeMs > (updatedAt ?? 0)) {
          updatedAt = info.mtimeMs
          logName = file.name
        }
      }
      map.set(entry.name, {
        slug: slug.name,
        dir,
        logName,
        bytes,
        fileCount,
        updatedAt,
        present: true,
      })
    }
  }
  logIndex = { home, at: now, map }
  return map
}

/** Session ids that still own a log directory on disk. */
export async function listStoredSessionIds(home, options = {}) {
  const logs = await scanLogs(home, options)
  return [...logs.keys()]
}

/** Session ids that still have a projection cache file. */
export async function listCachedSessionIds(home) {
  const { projections } = shelfPaths(home)
  const out = []
  for (const entry of await readDirectory(projections)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    if (SESSION_ID_PATTERN.test(id)) out.push(id)
  }
  return out
}

function workspaceIndex(workspaces) {
  const bySession = new Map()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) bySession.set(id, workspace)
  }
  return bySession
}

async function buildEntry(home, sessionId, context) {
  const { archived, pinned, bySession, logs } = context
  const issues = []
  const workspace = bySession.get(sessionId) ?? null
  const log = logs.get(sessionId) ?? null

  const projection = await readProjection(home, sessionId)
  if (!projection.ok) issues.push(projection.reason === 'missing' ? 'no-projection' : 'broken-projection')
  if (!log) issues.push('no-log')
  if (!workspace) issues.push('unregistered')

  const createdAt = projection.createdAt ?? null
  const updatedAt = log?.updatedAt ?? createdAt ?? null
  return {
    id: sessionId,
    title: projection.title || projection.prompt || null,
    cwd: projection.cwd ?? workspace?.path ?? null,
    createdAt,
    updatedAt,
    archived: archived.has(sessionId),
    pinned: pinned.has(sessionId),
    workspaceId: workspace?.id ?? null,
    workspaceTitle: workspace?.title ?? null,
    workspacePath: workspace?.path ?? null,
    log: log
      ? { present: true, slug: log.slug, file: log.logName, bytes: log.bytes, files: log.fileCount }
      : { present: false, slug: null, file: null, bytes: 0, files: 0 },
    issues,
  }
}

/**
 * Compose the whole shelf snapshot: archived sessions, favourites and (when
 * asked) every known session. `scope` keeps the payload small for narrow views.
 */
export async function readShelf(home, { scope = 'both', fresh = false } = {}) {
  const registry = await readRegistry(home)
  const logs = await scanLogs(home, { fresh })
  const archived = new Set(registry.archivedSessionIds)
  const pinned = new Set(registry.pinnedSessionIds)
  const bySession = workspaceIndex(registry.workspaces)

  const wanted = new Set()
  if (scope === 'all' || scope === 'both' || scope === 'archived') for (const id of archived) wanted.add(id)
  if (scope === 'all' || scope === 'both' || scope === 'pinned') for (const id of pinned) wanted.add(id)
  if (scope === 'all') {
    for (const id of bySession.keys()) wanted.add(id)
    for (const id of logs.keys()) wanted.add(id)
  }

  const context = { archived, pinned, bySession, logs }
  const sessions = []
  for (const id of wanted) sessions.push(await buildEntry(home, id, context))
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  return {
    generatedAt: Date.now(),
    home,
    registryOk: registry.ok,
    registryIssue: registry.ok ? null : registry.reason,
    workspaces: registry.workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessionCount: workspace.sessionIds.length,
      archivedCount: workspace.sessionIds.filter((id) => archived.has(id)).length,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })),
    archivedSessionIds: [...archived],
    pinnedSessionIds: [...pinned],
    sessions,
    counts: {
      archived: archived.size,
      pinned: pinned.size,
      listed: sessions.length,
    },
  }
}

/** Cached snapshot for the HTTP layer; bypassed by `fresh`. */
let shelfCache = { home: null, scope: null, at: 0, value: null }

export async function readShelfCached(home, options = {}) {
  const scope = options.scope ?? 'both'
  const now = Date.now()
  if (
    !options.fresh &&
    shelfCache.value &&
    shelfCache.home === home &&
    shelfCache.scope === scope &&
    now - shelfCache.at < SNAPSHOT_TTL_MS
  ) {
    return shelfCache.value
  }
  const value = await readShelf(home, { scope, fresh: options.fresh })
  shelfCache = { home, scope, at: now, value }
  return value
}

export function invalidateShelfCache() {
  shelfCache = { home: null, scope: null, at: 0, value: null }
  logIndex = { home: null, at: 0, map: new Map() }
}

async function writeRegistryAtomic(home, value) {
  const { registry } = shelfPaths(home)
  const temp = registry + '.shelf-' + process.pid + '-' + Date.now() + '.tmp'
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(temp, registry)
}

/**
 * Permanently remove sessions: logs, projection cache and every registry
 * mention. Sessions touched within the active window are refused unless the
 * caller explicitly forces the removal. `mutateRegistry: false` leaves the
 * registry table to the caller, which is the right choice while the harness is
 * running: the live domain owns that file and the registry API must be used
 * instead of an out-of-band rewrite.
 */
export async function purgeSessions(home, ids, { force = false, now = Date.now(), mutateRegistry = true } = {}) {
  const requested = uniqueIds(ids).filter((id) => SESSION_ID_PATTERN.test(id))
  const rejected = uniqueIds(ids).filter((id) => !SESSION_ID_PATTERN.test(id)).map((id) => ({ id, reason: 'invalid-id' }))
  if (requested.length === 0) return { removed: [], rejected, skipped: [] }

  const logs = await scanLogs(home, { fresh: true })
  const registry = await readRegistry(home)
  const removed = []
  const skipped = []

  const survivors = new Set(requested)
  if (!force) {
    for (const id of requested) {
      const log = logs.get(id)
      const lastTouch = log?.updatedAt ?? 0
      if (lastTouch && now - lastTouch < ACTIVE_WINDOW_MS) {
        survivors.delete(id)
        skipped.push({ id, reason: 'recently-active', lastTouch })
      }
    }
  }

  const { projections } = shelfPaths(home)
  for (const id of survivors) {
    const log = logs.get(id)
    let bytes = log?.bytes ?? 0
    let files = log?.files ?? 0
    try {
      if (log?.dir) await rm(log.dir, { recursive: true, force: true, maxRetries: 2 })
      await rm(join(projections, id + '.json'), { force: true })
      removed.push({ id, bytes, files })
    } catch (error) {
      skipped.push({ id, reason: 'io-error:' + (error?.code ?? 'unknown') })
    }
  }

  if (removed.length > 0 && mutateRegistry && registry.ok && registry.raw) {
    const value = registry.raw
    const gone = new Set(removed.map((entry) => entry.id))
    if (value.global && typeof value.global === 'object') {
      if (Array.isArray(value.global.archivedSessionIds)) {
        value.global.archivedSessionIds = value.global.archivedSessionIds.filter((id) => !gone.has(id))
      }
      if (Array.isArray(value.global.pinnedSessionIds)) {
        value.global.pinnedSessionIds = value.global.pinnedSessionIds.filter((id) => !gone.has(id))
      }
    }
    const table = value.tables?.workspaces
    if (table && typeof table === 'object') {
      for (const row of Object.values(table)) {
        if (row && Array.isArray(row.sessionIds)) row.sessionIds = row.sessionIds.filter((id) => !gone.has(id))
      }
    }
    try {
      await writeRegistryAtomic(home, value)
    } catch (error) {
      skipped.push({ id: '*registry*', reason: 'io-error:' + (error?.code ?? 'unknown') })
    }
  }

  invalidateShelfCache()
  return { removed, rejected, skipped }
}

/**
 * Drop projection caches that no longer parse. The harness rebuilds a cache the
 * next time it opens the session, and the session log itself is never touched.
 */
export async function repairProjections(home, ids) {
  const { projections } = shelfPaths(home)
  const repaired = []
  const skipped = []
  for (const id of uniqueIds(ids)) {
    if (!SESSION_ID_PATTERN.test(id)) {
      skipped.push({ id, reason: 'invalid-id' })
      continue
    }
    const file = join(projections, id + '.json')
    const result = await readJson(file)
    if (result.ok) {
      skipped.push({ id, reason: 'healthy' })
      continue
    }
    if (result.missing) {
      skipped.push({ id, reason: 'missing' })
      continue
    }
    try {
      await rm(file, { force: true })
      repaired.push(id)
    } catch (error) {
      skipped.push({ id, reason: 'io-error:' + (error?.code ?? 'unknown') })
    }
  }
  if (repaired.length > 0) invalidateShelfCache()
  return { repaired, skipped }
}

/**
 * Drop archive/favourite ids that no longer have any session on disk. These are
 * leftovers written by tools that removed logs behind the registry's back.
 */
export async function pruneOrphanIds(home) {
  const registry = await readRegistry(home)
  if (!registry.ok || !registry.raw) return { removed: [], reason: registry.reason }

  const logs = await scanLogs(home, { fresh: true })
  const known = new Set([...logs.keys(), ...registry.workspaces.flatMap((workspace) => workspace.sessionIds)])
  const gone = (ids) => ids.filter((id) => !known.has(id))

  const archivedOrphans = gone(registry.archivedSessionIds)
  const pinnedOrphans = gone(registry.pinnedSessionIds)
  if (archivedOrphans.length === 0 && pinnedOrphans.length === 0) return { removed: [], reason: null }

  const value = registry.raw
  const drop = new Set([...archivedOrphans, ...pinnedOrphans])
  if (value.global && typeof value.global === 'object') {
    if (Array.isArray(value.global.archivedSessionIds)) {
      value.global.archivedSessionIds = value.global.archivedSessionIds.filter((id) => !drop.has(id))
    }
    if (Array.isArray(value.global.pinnedSessionIds)) {
      value.global.pinnedSessionIds = value.global.pinnedSessionIds.filter((id) => !drop.has(id))
    }
  }
  await writeRegistryAtomic(home, value)
  invalidateShelfCache()
  return { removed: [...drop], reason: null, archived: archivedOrphans, pinned: pinnedOrphans }
}
