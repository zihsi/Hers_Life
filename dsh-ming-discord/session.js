function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')
}
function eventList(session) {
  const candidates = [session?.events, session?.eventLog, session?.history, session?.store?.events, session?.log?.events]
  return candidates.find(Array.isArray) ?? []
}
export function turnOutput(session, afterSeq = -1) {
  const out = { text: '', images: [], files: [] }
  for (const event of eventList(session)) {
    const seq = Number(event?.seq ?? event?.data?.seq ?? -1)
    if (seq <= afterSeq) continue
    const type = String(event?.type ?? '')
    const data = event?.data ?? {}
    if (type === 'assistant/message' || type === 'assistant/final' || type === 'message/assistant') {
      const message = data.message ?? data
      const text = contentText(message.content ?? message.text)
      if (text) out.text += (out.text ? '\n' : '') + text
      for (const block of message.content ?? []) {
        if (block?.type === 'image' && block.attachment) out.images.push(block.attachment)
        if (block?.type === 'file' && block.file) out.files.push(block.file)
      }
    }
    if (type === 'attachment/image' && data.ref) out.images.push(data.ref)
    if (type === 'attachment/file' && data.ref) out.files.push(data.ref)
  }
  return out
}
export function lastAssistantText(session, afterSeq = -1) { return turnOutput(session, afterSeq).text }
