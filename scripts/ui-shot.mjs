/**
 * Screenshot helper for local UI checks.
 *
 * Opens the running GUI in a headless browser through the DevTools protocol,
 * clicks the shelf rail button, opens the sort picker and writes PNGs to the
 * directory given as the first argument. Requires the GUI to be running and a
 * Chromium build with --remote-debugging-port (see the caller).
 *
 * The web GUI signs browsers in with a per-process launch token, so pass its
 * cookie secret for headless runs:
 *   DSH_SECRET=<secret from .credentials.yaml> URL=http://127.0.0.1:<port>/ \
 *   node scripts/ui-shot.mjs <out-dir>
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { join } from 'node:path'

const endpoint = process.env.CDP || 'http://127.0.0.1:9222'
const pageUrl = process.env.URL || 'http://127.0.0.1:54126'
const outDir = process.argv[2] || join(process.cwd(), '.ui-shots')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const b64url = (buffer) => Buffer.from(buffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Mint the browser-session cookie the GUI expects, so headless runs skip the launch token. */
const sessionCookie = (secretB64, authority) => {
  const secret = Buffer.from(secretB64, 'base64')
  const name = `dsh-auth-${b64url(createHash('sha256').update(authority).digest())}`
  const now = Date.now()
  const body = b64url(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 }))
  const value = `v1.${body}.${b64url(createHmac('sha256', secret).update(body).digest())}`
  return { name, value }
}

const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' }).then((r) => r.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let seq = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})

const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    seq += 1
    pending.set(seq, { resolve, reject })
    socket.send(JSON.stringify({ id: seq, method, params }))
  })

const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
  return result.result.value
}

const shot = async (name) => {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = join(outDir, name)
  await writeFile(file, Buffer.from(data, 'base64'))
  return file
}

await mkdir(outDir, { recursive: true })
await call('Page.enable')
await call('Runtime.enable')

const secretB64 = process.env.DSH_SECRET
if (secretB64) {
  const authority = new URL(pageUrl).host
  const cookie = sessionCookie(secretB64, authority)
  await call('Network.enable')
  const set = await call('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    url: pageUrl,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  })
  console.log('cookie', JSON.stringify(set))
}

await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await call('Page.navigate', { url: pageUrl })
await sleep(7000)

const rail = await evaluate(`(() => {
  const nodes = [...document.querySelectorAll('button, a, [role="button"]')]
  const hit = nodes.find((node) => {
    const text = [node.getAttribute('title'), node.getAttribute('aria-label'), node.textContent].filter(Boolean).join(' ')
    return text.includes('会话书柜') || text.includes('Session shelf')
  })
  if (!hit) return 'not-found'
  hit.click()
  return 'clicked:' + (hit.getAttribute('title') || hit.textContent || '').slice(0, 60)
})()`)
console.log('rail', rail)
await sleep(1500)
console.log('panel', await shot('panel.png'))

const opened = await evaluate(`(() => {
  const trigger = document.querySelector('.dss-dd-btn')
  if (!trigger) return 'no-dropdown'
  trigger.click()
  return 'opened'
})()`)
console.log('dropdown', opened)
await sleep(500)
console.log('menu', await shot('menu.png'))

await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(300)

const dismissed = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === '继续')
  if (!button) return 'no-modal'
  button.click()
  return 'dismissed'
})()`)
console.log('modal', dismissed)

const tab = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dss-tab')].find((node) => (node.textContent || '').includes('全部'))
  if (!button) return 'no-tab'
  button.click()
  return 'switched'
})()`)
console.log('tab', tab)
await sleep(800)
console.log('rows', await shot('rows.png'))

const rect = await evaluate(`(() => {
  const row = document.querySelector('.dss-row')
  if (!row) return null
  const box = row.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
})()`)
if (rect) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y })
  await sleep(500)
  console.log('hover', await shot('row-hover.png'))
}

const collapsed = await evaluate(`(() => {
  const head = document.querySelector('.dss-group-head')
  if (!head) return 'no-head'
  head.click()
  return 'collapsed'
})()`)
console.log('group', collapsed)
await sleep(400)
console.log('collapsed', await shot('collapsed.png'))

await evaluate(`document.querySelector('.dss-group-head').click()`)
await sleep(300)

const picks = await evaluate(`(() => {
  const boxes = [...document.querySelectorAll('.dss-row .dss-check')].slice(0, 2)
  boxes.forEach((box) => box.click())
  return boxes.length
})()`)
console.log('picked', picks)
await sleep(400)
console.log('selection', await shot('selection.png'))

const dialog = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dss-selectionbar button')].find((node) => (node.textContent || '').includes('删除'))
  if (!button) return 'no-batch-delete'
  button.click()
  return 'dialog'
})()`)
console.log('batch', dialog)
await sleep(400)
console.log('confirm', await shot('confirm.png'))

socket.close()
await fetch(`${endpoint}/json/close/${target.id}`)
