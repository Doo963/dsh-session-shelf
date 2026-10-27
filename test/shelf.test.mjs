import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createShelfServer,
  detachLiveSession,
  detachRegistryAccounts,
  publishRemoval,
} from '../lib/index.js'
import {
  invalidateShelfCache,
  pruneOrphanIds,
  purgeSessions,
  readRegistry,
  readShelf,
  readShelfCached,
  repairProjections,
  resolveHome,
} from '../lib/shelf.js'

const NOW = Date.now()
const OLD = new Date(2024, 0, 1, 0, 0, 0)

async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'session-shelf-'))
  await mkdir(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  await mkdir(join(home, 'sessions'), { recursive: true })
  return home
}

function projection(sessionId, { title, prompt, cwd, createdAt } = {}) {
  return {
    version: 7,
    record: {
      identity: { formatVersion: 4, createdAt: createdAt ?? NOW - 3 * 86400_000, cwd: cwd ?? 'D:\\work' },
      rows: {
        ...(title ? { title: { ver: 1, seq: 10, val: title } } : {}),
        ...(prompt ? { titleInput: { ver: 3, seq: 10, val: { first: { seq: 1, text: prompt }, count: 1, lastSeq: 1 } } } : {}),
      },
    },
  }
}

async function writeProjection(home, sessionId, data) {
  await writeFile(join(home, 'storages', 'session_projcache', 'sessions', sessionId + '.json'), JSON.stringify(data), 'utf8')
}

async function writeLog(home, slug, sessionId, { bytes = 128, old = false } = {}) {
  const dir = join(home, 'sessions', slug, sessionId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl.zstd')
  await writeFile(file, Buffer.alloc(bytes, 7))
  if (old) await utimes(file, OLD, OLD)
  return { dir, file }
}

async function writeRegistry(home, { archived = [], pinned = [], workspaces = [] }) {
  const tables = { workspaces: {} }
  for (const workspace of workspaces) tables.workspaces[workspace.id] = workspace
  await writeFile(
    join(home, 'storages', 'workspace.json'),
    JSON.stringify(
      {
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, archivedSessionIds: archived, pinnedSessionIds: pinned, workspaceIds: workspaces.map((w) => w.id) },
        tables,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function workspaceRow(id, path, title, sessionIds) {
  return { path, title, sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }
}

const OLD_ID = 'session-aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'
const NEW_ID = 'session-bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb'

test('resolveHome follows DSH_HOME and falls back to the home directory', () => {
  assert.equal(resolveHome({ DSH_HOME: 'D:\\custom\\dsh' }, 'C:\\Users\\x'), 'D:\\custom\\dsh')
  assert.equal(resolveHome({ DSH_HOME: '  ' }, 'C:\\Users\\x'), join('C:\\Users\\x', '.dsh'))
  assert.equal(resolveHome({}, 'C:\\Users\\x'), join('C:\\Users\\x', '.dsh'))
})

test('readRegistry survives a missing registry file', async () => {
  const home = await makeHome()
  try {
    const registry = await readRegistry(home)
    assert.equal(registry.ok, false)
    assert.equal(registry.reason, 'missing')
    assert.deepEqual(registry.archivedSessionIds, [])
    assert.deepEqual(registry.workspaces, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('readShelf lists archived sessions with metadata and issues', async () => {
  const home = await makeHome()
  try {
    await writeRegistry(home, {
      archived: [OLD_ID, NEW_ID, 'session-cccccccc-3333-4ccc-8ccc-cccccccccccc'],
      pinned: [NEW_ID],
      workspaces: [workspaceRow('ws-1', 'D:\\work', 'Work', [OLD_ID, 'session-dddddddd-4444-4ddd-8ddd-dddddddddddd'])],
    })
    await writeProjection(home, OLD_ID, projection(OLD_ID, { title: 'Archived chat', createdAt: NOW - 10 * 86400_000 }))
    await writeProjection(home, NEW_ID, projection(NEW_ID, { prompt: 'first prompt', cwd: 'D:\\other' }))
    await writeLog(home, '--D-work--', OLD_ID, { bytes: 2048, old: true })

    const shelf = await readShelf(home, { scope: 'both', fresh: true })
    assert.equal(shelf.counts.archived, 3)
    assert.equal(shelf.counts.pinned, 1)

    const old = shelf.sessions.find((s) => s.id === OLD_ID)
    assert.ok(old)
    assert.equal(old.title, 'Archived chat')
    assert.equal(old.cwd, 'D:\\work')
    assert.equal(old.archived, true)
    assert.equal(old.pinned, false)
    assert.equal(old.workspaceTitle, 'Work')
    assert.equal(old.log.present, true)
    assert.equal(old.log.bytes, 2048)
    assert.deepEqual(old.issues, [])

    const fresh = shelf.sessions.find((s) => s.id === NEW_ID)
    assert.ok(fresh)
    assert.equal(fresh.title, 'first prompt')
    assert.equal(fresh.pinned, true)
    assert.equal(fresh.cwd, 'D:\\other')
    assert.ok(fresh.issues.includes('no-log'))
    assert.ok(fresh.issues.includes('unregistered'))

    const ghost = shelf.sessions.find((s) => s.id === 'session-cccccccc-3333-4ccc-8ccc-cccccccccccc')
    assert.ok(ghost)
    assert.ok(ghost.issues.includes('no-projection'))
    assert.ok(ghost.issues.includes('no-log'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('scope keeps unarchived sessions out of the archived view', async () => {
  const home = await makeHome()
  try {
    await writeRegistry(home, {
      archived: [OLD_ID],
      workspaces: [workspaceRow('ws-1', 'D:\\work', 'Work', [OLD_ID, NEW_ID])],
    })
    await writeProjection(home, OLD_ID, projection(OLD_ID, { title: 'kept' }))
    await writeProjection(home, NEW_ID, projection(NEW_ID, { title: 'live one' }))
    await writeLog(home, '--D-work--', OLD_ID, { old: true })
    await writeLog(home, '--D-work--', NEW_ID)

    const archivedOnly = await readShelf(home, { scope: 'archived', fresh: true })
    assert.deepEqual(archivedOnly.sessions.map((s) => s.id), [OLD_ID])

    const everything = await readShelf(home, { scope: 'all', fresh: true })
    assert.equal(everything.sessions.length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('purgeSessions deletes logs, cache and registry mentions, refusing active ones', async () => {
  const home = await makeHome()
  try {
    await writeRegistry(home, {
      archived: [OLD_ID, NEW_ID],
      pinned: [NEW_ID],
      workspaces: [workspaceRow('ws-1', 'D:\\work', 'Work', [OLD_ID, NEW_ID])],
    })
    await writeProjection(home, OLD_ID, projection(OLD_ID, { title: 'gone' }))
    await writeProjection(home, NEW_ID, projection(NEW_ID, { title: 'active' }))
    const oldLog = await writeLog(home, '--D-work--', OLD_ID, { old: true })
    await writeLog(home, '--D-work--', NEW_ID)

    const result = await purgeSessions(home, [OLD_ID, NEW_ID])
    assert.equal(result.removed.length, 1)
    assert.equal(result.removed[0].id, OLD_ID)
    assert.equal(result.skipped.length, 1)
    assert.equal(result.skipped[0].id, NEW_ID)
    assert.equal(result.skipped[0].reason, 'recently-active')

    const registry = await readRegistry(home)
    assert.deepEqual(registry.archivedSessionIds, [NEW_ID])
    assert.deepEqual(registry.pinnedSessionIds, [NEW_ID])
    assert.deepEqual(registry.workspaces[0].sessionIds, [NEW_ID])

    const after = await readShelf(home, { scope: 'all', fresh: true })
    assert.equal(after.sessions.some((s) => s.id === OLD_ID), false)

    const forced = await purgeSessions(home, [NEW_ID], { force: true })
    assert.equal(forced.removed.length, 1)
    const finalRegistry = await readRegistry(home)
    assert.deepEqual(finalRegistry.archivedSessionIds, [])
    assert.deepEqual(finalRegistry.workspaces[0].sessionIds, [])
    await assert.rejects(rm(oldLog.dir, { recursive: true }), /ENOENT/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('purgeSessions can leave the registry table to the caller', async () => {
  const home = await makeHome()
  try {
    await writeRegistry(home, {
      archived: [OLD_ID],
      pinned: [],
      workspaces: [workspaceRow('ws-1', 'D:\\work', 'Work', [OLD_ID])],
    })
    await writeLog(home, '--D-work--', OLD_ID, { old: true })
    const before = await readFile(join(home, 'storages', 'workspace.json'), 'utf8')

    const result = await purgeSessions(home, [OLD_ID], { mutateRegistry: false })
    assert.equal(result.removed.length, 1)

    const after = await readFile(join(home, 'storages', 'workspace.json'), 'utf8')
    assert.equal(after, before, 'the live registry domain owns that file while the harness runs')
    const registry = await readRegistry(home)
    assert.deepEqual(registry.workspaces[0].sessionIds, [OLD_ID])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('purgeSessions refuses ids that could escape the sessions directory', async () => {
  const home = await makeHome()
  try {
    const result = await purgeSessions(home, ['../storages', 'session-a/../b', {}])
    assert.equal(result.removed.length, 0)
    assert.equal(result.rejected.length, 2)
    assert.ok(result.rejected.some((entry) => entry.id === '../storages'))
    assert.ok(result.rejected.some((entry) => entry.id === 'session-a/../b'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('pruneOrphanIds drops entries whose session is gone', async () => {
  const home = await makeHome()
  try {
    await writeRegistry(home, {
      archived: [OLD_ID, NEW_ID],
      pinned: ['session-ffffffff-6666-4fff-8fff-ffffffffffff'],
      workspaces: [workspaceRow('ws-1', 'D:\\work', 'Work', [OLD_ID])],
    })
    await writeLog(home, '--D-work--', OLD_ID, { old: true })
    await writeLog(home, '--D-work--', NEW_ID, { old: true })

    const result = await pruneOrphanIds(home)
    assert.deepEqual(result.archived, [])
    assert.deepEqual(result.pinned, ['session-ffffffff-6666-4fff-8fff-ffffffffffff'])

    const registry = await readRegistry(home)
    assert.deepEqual(registry.archivedSessionIds, [OLD_ID, NEW_ID])
    assert.deepEqual(registry.pinnedSessionIds, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('repairProjections clears only unreadable projection caches', async () => {
  const home = await makeHome()
  try {
    await writeProjection(home, OLD_ID, projection(OLD_ID, { title: 'healthy' }))
    const broken = join(home, 'storages', 'session_projcache', 'sessions', NEW_ID + '.json')
    await writeFile(broken, '{ this is not json', 'utf8')

    const result = await repairProjections(home, [OLD_ID, NEW_ID, '../escape'])
    assert.deepEqual(result.repaired, [NEW_ID])
    assert.ok(result.skipped.some((entry) => entry.id === OLD_ID && entry.reason === 'healthy'))
    assert.ok(result.skipped.some((entry) => entry.id === '../escape' && entry.reason === 'invalid-id'))
    await assert.rejects(readFile(broken, 'utf8'), /ENOENT/)

    const again = await repairProjections(home, [NEW_ID])
    assert.deepEqual(again.repaired, [])
    assert.ok(again.skipped.some((entry) => entry.id === NEW_ID && entry.reason === 'missing'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('detach helpers remove the identity from the live store, the registry and clients', async () => {
  const calls = []
  const live = new Map([[OLD_ID, { id: OLD_ID }]])
  const store = {
    get: (id) => live.get(id),
    flush: async () => {},
    liveEntryFor: (session) => ({ session }),
    detachEntered: (entry) => live.delete(entry.session.id),
  }
  const workspace = {
    id: 'ws-live',
    sessionIds: [OLD_ID, NEW_ID],
    detachSession: async (id) => {
      calls.push(['detach', id])
      workspace.sessionIds = workspace.sessionIds.filter((value) => value !== id)
    },
  }
  const registry = {
    list: () => [workspace],
    unarchiveSession: async (id) => calls.push(['unarchive', id]),
    unpinSession: async (id) => calls.push(['unpin', id]),
  }
  const ctx = {
    get: (name) => (name === 'sessions' ? store : name === 'workspaceRegistry' ? registry : undefined),
    emit: (event, id) => calls.push(['emit', event, id]),
  }

  assert.equal(await detachLiveSession(ctx, OLD_ID), true)
  assert.equal(live.has(OLD_ID), false, 'the live Session object must leave the store')
  assert.equal(await detachLiveSession(ctx, NEW_ID), false)

  assert.equal(await detachRegistryAccounts(ctx, OLD_ID), true)
  assert.deepEqual(workspace.sessionIds, [NEW_ID])
  assert.deepEqual(
    calls.filter((entry) => entry[0] !== 'emit'),
    [['detach', OLD_ID], ['unarchive', OLD_ID], ['unpin', OLD_ID]],
  )

  publishRemoval(ctx, OLD_ID)
  assert.deepEqual(calls.at(-1), ['emit', 'api-session/removed', OLD_ID])
})

test('the http surface answers /state and rejects unknown routes', async () => {
  const home = await makeHome()
  const server = createShelfServer({ home })
  try {
    await writeRegistry(home, { archived: [OLD_ID], workspaces: [] })
    await writeProjection(home, OLD_ID, projection(OLD_ID, { title: 'over http' }))
    await writeLog(home, '--D-work--', OLD_ID, { old: true })
    invalidateShelfCache()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const base = 'http://127.0.0.1:' + address.port

    const state = await fetch(base + '/api/session-shelf/state?scope=all').then((response) => response.json())
    assert.equal(state.counts.archived, 1)
    assert.equal(state.sessions[0].title, 'over http')

    const missing = await fetch(base + '/api/session-shelf/nope')
    assert.equal(missing.status, 404)

    const cached = await readShelfCached(home, { scope: 'all' })
    assert.equal(cached.counts.archived, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  }
})
