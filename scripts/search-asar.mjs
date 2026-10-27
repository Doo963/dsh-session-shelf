// Throwaway helper: search the Electron asar blob for literal needles and print
// readable context around each hit (the archive is not a plain directory).
import { readFile } from 'node:fs/promises'

const file = process.argv[2]
const needles = process.argv.slice(3)
if (!file || needles.length === 0) {
  console.error('usage: node search-asar.mjs <asar> <needle> [needle...]')
  process.exit(2)
}

const buf = await readFile(file)
for (const needle of needles) {
  const hits = []
  let at = buf.indexOf(needle)
  while (at !== -1 && hits.length < 20) {
    hits.push(at)
    at = buf.indexOf(needle, at + needle.length)
  }
  console.log(`\n=== ${needle}: ${hits.length} hit(s) ===`)
  for (const pos of hits) {
    const start = Math.max(0, pos - 400)
    const end = Math.min(buf.length, pos + 600)
    const chunk = buf.subarray(start, end).toString('utf8').replace(/[\u0000-\u001f]+/g, ' ')
    console.log(`--- @${pos} ---\n${chunk}\n`)
  }
}
