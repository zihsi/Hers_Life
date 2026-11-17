import { randomUUID } from 'node:crypto'
export function newId() { return randomUUID() }
export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))) }
export function truncate(value, max = 400) {
  const text = String(value ?? '')
  const n = Math.max(0, Number(max) || 0)
  return text.length > n ? text.slice(0, n) + '…' : text
}
export function chunkText(value, limit = 1900) {
  const text = String(value ?? '')
  const max = Math.max(100, Math.min(2000, Number(limit) || 1900))
  if (text.length <= max) return text.trim() ? [text] : []
  const chunks = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < Math.floor(max * 0.55)) cut = rest.lastIndexOf(' ', max)
    if (cut < Math.floor(max * 0.55)) cut = max
    chunks.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}
export function tidyReply(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
}
export function safe(logger, label, fn) {
  return (...args) => {
    try {
      const result = fn(...args)
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).catch((error) => logger?.warn?.(label + ': ' + String(error?.stack ?? error?.message ?? error)))
      }
      return result
    } catch (error) {
      logger?.warn?.(label + ': ' + String(error?.stack ?? error?.message ?? error))
      return undefined
    }
  }
}
export function backoff(attempt, min = 800, max = 20_000) {
  const n = Math.max(0, Math.min(12, Number(attempt) || 0))
  const base = Math.min(max, min * (2 ** n))
  return Math.round(base * (0.8 + Math.random() * 0.4))
}
