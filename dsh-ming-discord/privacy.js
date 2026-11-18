import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PRIVATE_DIARY_START = /^-\s+\d{4}-\d{2}-\d{2}T[^\s]+\s+私聊\s+/u
const DIARY_ENTRY_START = /^-\s+\d{4}-\d{2}-\d{2}T[^\s]+\s+/u

/**
 * Older Discord adapters copied DM replies into the shared diary, which the
 * opening-memory plugin injects into every session. Move those exact legacy
 * entries (including multi-line continuations) out of the workspace diary
 * before any agent reads it. The private text is preserved under ~/.dsh,
 * outside the diary/RAG input paths.
 */
export async function quarantinePrivateDmDiary(workspace, privateRoot) {
  const diaryDir = path.join(path.resolve(workspace), 'diary')
  const quarantineDir = path.join(path.resolve(privateRoot), 'privacy-quarantine', 'private-dm-diary')
  let filesChanged = 0
  let entriesMoved = 0

  let names = []
  try {
    names = (await readdir(diaryDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/i.test(name)).sort()
  } catch {
    return { filesChanged, entriesMoved }
  }

  for (const name of names) {
    const file = path.join(diaryDir, name)
    let raw
    try { raw = await readFile(file, 'utf8') } catch { continue }
    const lines = raw.match(/[^\n]*\n|[^\n]+$/g) ?? []
    const kept = []
    const privateBlocks = []

    for (let i = 0; i < lines.length;) {
      if (!PRIVATE_DIARY_START.test(lines[i].replace(/\r?\n$/, ''))) {
        kept.push(lines[i])
        i += 1
        continue
      }
      const block = [lines[i]]
      i += 1
      // writeJournal may have written a multi-line model reply. Keep its whole
      // continuation with the private header until the next dated journal item.
      while (i < lines.length && !DIARY_ENTRY_START.test(lines[i].replace(/\r?\n$/, ''))) {
        block.push(lines[i])
        i += 1
      }
      privateBlocks.push(block.join(''))
    }

    if (privateBlocks.length === 0) continue
    const privateText = privateBlocks.join('')
    const digest = createHash('sha256').update(name + '\0' + privateText).digest('hex').slice(0, 20)
    const archive = path.join(quarantineDir, name + '.' + digest + '.private.md')
    await mkdir(quarantineDir, { recursive: true, mode: 0o700 })
    try {
      await writeFile(archive, privateText, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }

    const temp = file + '.privacy-' + process.pid
    await writeFile(temp, kept.join(''), 'utf8')
    await rename(temp, file)
    filesChanged += 1
    entriesMoved += privateBlocks.length
  }
  return { filesChanged, entriesMoved, archiveDir: quarantineDir }
}
