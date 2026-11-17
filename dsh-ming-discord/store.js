import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
export async function appendLine(root, filename, value, maxChars = 16_000) {
  const name = path.basename(String(filename ?? ''))
  if (!name || name !== filename) throw new Error('invalid log filename')
  const line = JSON.stringify(value)
  if (line.length > Math.max(1000, Number(maxChars) || 16_000)) return false
  await mkdir(root, { recursive: true })
  await appendFile(path.join(root, name), line + '\n', 'utf8')
  return true
}
