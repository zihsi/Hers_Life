/**
 * Small compatibility shim for DSH attachment stores. When the host exposes no
 * supported writer, the bridge reports that image input is unavailable.
 */
export async function storeImage(store, input) {
  if (!store) throw new Error('attachment store unavailable')
  if (typeof store.storeImage === 'function') return store.storeImage(input)
  if (typeof store.writeImage === 'function') return store.writeImage(input)
  if (typeof store.createImage === 'function') return store.createImage(input)
  if (typeof store.putImage === 'function') return store.putImage(input)
  throw new Error('attachment store has no supported image writer')
}
export function toImageRef(stored, name = 'image') {
  if (stored?.attachment) return stored.attachment
  if (stored?.ref) return stored.ref
  return { ...stored, name: stored?.name ?? name }
}
