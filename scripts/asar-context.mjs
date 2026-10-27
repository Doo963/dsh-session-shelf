import fs from 'node:fs'
const file = process.argv[2]
const needles = process.argv.slice(3)
const buf = fs.readFileSync(file)
const text = buf.toString('utf8')
for (const n of needles) {
  let idx = -1, count = 0
  while ((idx = text.indexOf(n, idx + 1)) !== -1 && count < 3) {
    count++
    const start = Math.max(0, idx - 700), end = Math.min(text.length, idx + 900)
    console.log(`\n===== ${n} @${idx} =====`)
    console.log(text.slice(start, end).replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '.'))
  }
  if (!count) console.log(`\n===== ${n}: not found =====`)
}
