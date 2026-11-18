import { resolve } from 'node:path'
import { createActivityStore, fault } from './store.js'

export const name = 'ming-activities'
export const inject = ['hersLifeDiscord']

export function apply(ctx, config = {}) {
  const central = ctx.hersLifeDiscord?.getSetting?.('activities', {}) || {}
  if (central.enabled === false) return
  const configured = central.root || config.root || ctx.hersLifeDiscord?.workspace || ''
  const root = typeof configured === 'string' && configured.trim() ? resolve(configured.trim()) : ''
  const store = createActivityStore(root)
  ctx.inject(['connection', 'webServer'], c => {
    c.effect(() => c.webServer.register({
      kind: 'exact', path: '/dsh-ming-activities/activities',
      async handler(req, res) {
        const send = (status, data) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(data))
        }
        try {
          const rejection = c.connection?.requestRejection?.(req)
          if (rejection !== undefined) { send(rejection || 403, { error: 'rejected' }); return }
          if (req.method === 'GET') { send(200, await store.read()); return }
          if (req.method !== 'POST') { res.setHeader('allow', 'GET, POST'); send(405, { error: '只支持查看和保存活动。' }); return }
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fault(415, '请使用 JSON 请求。')
          const chunks = []; let size = 0
          for await (const chunk of req) {
            size += Buffer.byteLength(chunk)
            if (size > 65536) throw fault(413, '提交内容过长。')
            chunks.push(Buffer.from(chunk))
          }
          let body
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
          catch { throw fault(400, '提交内容不是有效 JSON。') }
          send(200, await store.mutate(body))
        } catch (e) { send(e.status || 500, { error: e.status ? e.message : '活动暂时不可用，请刷新后重试。' }) }
      },
    }), 'ming-activities: manual activity cards')
  })
}
