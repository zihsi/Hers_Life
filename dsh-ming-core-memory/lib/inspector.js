// Read-only view of existing note files. No capture, rewriting, or model calls.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createInspectorRoute({ directory, parseNote, describe, requestRejection }) {
  return {
    kind: 'exact', path: '/dsh-core-memory/inspector',
    async handler(req, res) {
      const send = (code, data) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(data))
      }
      if (req.method !== 'GET') { res.setHeader('allow', 'GET'); send(405, { error: '这里只提供查看，不修改记忆。' }); return }      const rejection = typeof requestRejection === 'function' ? requestRejection(req) : undefined
      if (rejection !== undefined) { send(rejection || 403, { error: 'rejected' }); return }

      try {
        const url = new URL(req.url, 'http://localhost')
        const id = url.searchParams.get('id')
        let entries
        try { entries = await readdir(directory(), { withFileTypes: true }) }
        catch (e) { if (e.code === 'ENOENT') entries = []; else throw e }
        const names = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name)
        const read = async name => {
          const parsed = parseNote(await readFile(join(directory(), name), 'utf8'))
          if (parsed.meta.deleted === 'true') return null
          const id = name.slice(0, -3)
          return { ...describe(parsed.meta, id), id, file: 'memory/notes/' + name, body: parsed.body }
        }
        if (id !== null) {
          // Match an enumerated file, never treat the request as a filesystem path.
          if (!id || /[\\/\0]/.test(id) || !names.includes(id + '.md')) { send(404, { error: '这条记忆不存在或已删除。' }); return }
          const note = await read(id + '.md')
          if (!note) { send(404, { error: '这条记忆已删除。' }); return }
          send(200, { note }); return
        }
        const notes = [], unreadable = []
        for (const name of names) {
          try {
            const note = await read(name)
            if (note) { const { body, ...summary } = note; notes.push(summary) }
          } catch { unreadable.push(name) }
        }
        notes.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
        send(200, { notes, unreadable })
      } catch { send(503, { error: '暂时读不到记忆文件，请检查目录访问权限后重试。' }) }
    },
  }
}
