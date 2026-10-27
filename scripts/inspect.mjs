#!/usr/bin/env node
/**
 * Print what the shelf would show for a harness data directory.
 *
 *   node scripts/inspect.mjs                 # uses DSH_HOME / ~/.dsh
 *   node scripts/inspect.mjs D:\custom\dsh   # explicit directory
 */
import { readShelf, resolveHome } from '../lib/shelf.js'

const home = process.argv[2] ?? resolveHome()
const shelf = await readShelf(home, { scope: 'all', fresh: true })

console.log('home           :', shelf.home)
console.log('registry       :', shelf.registryOk ? 'ok' : 'unreadable (' + shelf.registryIssue + ')')
console.log('workspaces     :', shelf.workspaces.length)
console.log('archived       :', shelf.counts.archived)
console.log('favourites     :', shelf.counts.pinned)
console.log('sessions listed:', shelf.counts.listed)
console.log('')
for (const workspace of shelf.workspaces) {
  console.log('  · ' + workspace.title + '  ' + (workspace.path ?? '') + '  [' + workspace.sessionCount + ' sessions, ' + workspace.archivedCount + ' archived]')
}
if (shelf.sessions.length > 0) {
  console.log('\nmost recent sessions:')
  for (const session of shelf.sessions.slice(0, 12)) {
    const flags = [session.archived ? 'archived' : '', session.pinned ? 'pinned' : '', ...session.issues].filter(Boolean).join(',')
    const when = session.updatedAt ? new Date(session.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : '-'
    console.log('  ' + when + '  ' + (session.title ?? '(untitled)').slice(0, 42).padEnd(42) + ' ' + flags)
  }
}
