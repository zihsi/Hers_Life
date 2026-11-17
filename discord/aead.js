/**
 * Pure-JS ChaCha20-Poly1305 AEAD (RFC 8439) plus XChaCha20 (HChaCha20) framing.
 *
 * The Windows Electron build ships BoringSSL without `chacha20-poly1305`, so
 * Discord's `aead_xchacha20_poly1305_rtpsize` voice mode cannot use node:crypto.
 * Voice frames are tiny (20 ms Opus) so a straightforward BigInt Poly1305 is
 * plenty fast, and it keeps the package free of native dependencies.
 */
import { Buffer } from 'node:buffer'

const SIGMA = Buffer.from('expand 32-byte k', 'ascii')

function rotl(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function quarterRound(state, a, b, c, d) {
  state[a] = (state[a] + state[b]) >>> 0
  state[d] = rotl(state[d] ^ state[a], 16)
  state[c] = (state[c] + state[d]) >>> 0
  state[b] = rotl(state[b] ^ state[c], 12)
  state[a] = (state[a] + state[b]) >>> 0
  state[d] = rotl(state[d] ^ state[a], 8)
  state[c] = (state[c] + state[d]) >>> 0
  state[b] = rotl(state[b] ^ state[c], 7)
}

function initialState(key, nonce16) {
  const state = new Uint32Array(16)
  for (let i = 0; i < 4; i += 1) state[i] = SIGMA.readUInt32LE(i * 4)
  for (let i = 0; i < 8; i += 1) state[4 + i] = key.readUInt32LE(i * 4)
  state[12] = nonce16.readUInt32LE(0)
  state[13] = nonce16.readUInt32LE(4)
  state[14] = nonce16.readUInt32LE(8)
  state[15] = nonce16.readUInt32LE(12)
  return state
}

/** HChaCha20: 32-byte subkey from a 32-byte key and a 16-byte nonce prefix. */
export function hchacha20(key, nonce16) {
  const state = initialState(key, nonce16)
  for (let round = 0; round < 10; round += 1) {
    quarterRound(state, 0, 4, 8, 12)
    quarterRound(state, 1, 5, 9, 13)
    quarterRound(state, 2, 6, 10, 14)
    quarterRound(state, 3, 7, 11, 15)
    quarterRound(state, 0, 5, 10, 15)
    quarterRound(state, 1, 6, 11, 12)
    quarterRound(state, 2, 7, 8, 13)
    quarterRound(state, 3, 4, 9, 14)
  }
  const out = Buffer.alloc(32)
  const words = [state[0], state[1], state[2], state[3], state[12], state[13], state[14], state[15]]
  for (let i = 0; i < 8; i += 1) out.writeUInt32LE(words[i], i * 4)
  return out
}

/** One 64-byte ChaCha20 keystream block. */
export function chacha20Block(key, counter, nonce12) {
  const state = new Uint32Array(16)
  for (let i = 0; i < 4; i += 1) state[i] = SIGMA.readUInt32LE(i * 4)
  for (let i = 0; i < 8; i += 1) state[4 + i] = key.readUInt32LE(i * 4)
  state[12] = counter >>> 0
  state[13] = nonce12.readUInt32LE(0)
  state[14] = nonce12.readUInt32LE(4)
  state[15] = nonce12.readUInt32LE(8)
  const working = Uint32Array.from(state)
  for (let round = 0; round < 10; round += 1) {
    quarterRound(working, 0, 4, 8, 12)
    quarterRound(working, 1, 5, 9, 13)
    quarterRound(working, 2, 6, 10, 14)
    quarterRound(working, 3, 7, 11, 15)
    quarterRound(working, 0, 5, 10, 15)
    quarterRound(working, 1, 6, 11, 12)
    quarterRound(working, 2, 7, 8, 13)
    quarterRound(working, 3, 4, 9, 14)
  }
  const out = Buffer.alloc(64)
  for (let i = 0; i < 16; i += 1) out.writeUInt32LE((working[i] + state[i]) >>> 0, i * 4)
  return out
}

/** XOR `data` with the ChaCha20 keystream starting at `counter`. */
export function chacha20Xor(key, nonce12, counter, data) {
  const out = Buffer.alloc(data.length)
  let offset = 0
  let block = counter >>> 0
  while (offset < data.length) {
    const stream = chacha20Block(key, block, nonce12)
    const take = Math.min(64, data.length - offset)
    for (let i = 0; i < take; i += 1) out[offset + i] = data[offset + i] ^ stream[i]
    offset += take
    block = (block + 1) >>> 0
  }
  return out
}

const P = (1n << 130n) - 5n

function readLittleEndian(buffer) {
  let value = 0n
  for (let i = buffer.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(buffer[i])
  return value
}

function writeLittleEndian(value, length) {
  const out = Buffer.alloc(length)
  let rest = value
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

/** Poly1305 one-shot MAC (RFC 8439 §2.5), BigInt arithmetic. */
export function poly1305(message, key) {
  const r = readLittleEndian(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn
  const s = readLittleEndian(key.subarray(16, 32))
  let accumulator = 0n
  for (let offset = 0; offset < message.length; offset += 16) {
    const chunk = message.subarray(offset, Math.min(offset + 16, message.length))
    const padded = Buffer.alloc(chunk.length + 1)
    chunk.copy(padded)
    padded[chunk.length] = 1
    accumulator = ((accumulator + readLittleEndian(padded)) * r) % P
  }
  accumulator = (accumulator + s) & ((1n << 128n) - 1n)
  return writeLittleEndian(accumulator, 16)
}

function pad16(length) {
  const remainder = length % 16
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(16 - remainder)
}

/** IETF AEAD_CHACHA20_POLY1305 seal (12-byte nonce). */
export function sealIetf(plaintext, aad, nonce12, key) {
  const polyKey = chacha20Block(key, 0, nonce12).subarray(0, 32)
  const ciphertext = chacha20Xor(key, nonce12, 1, plaintext)
  const aadLength = Buffer.alloc(8)
  aadLength.writeUInt32LE(aad.length, 0)
  const textLength = Buffer.alloc(8)
  textLength.writeUInt32LE(ciphertext.length, 0)
  const mac = poly1305(Buffer.concat([aad, pad16(aad.length), ciphertext, pad16(ciphertext.length), aadLength, textLength]), polyKey)
  return Buffer.concat([ciphertext, mac])
}

/** IETF AEAD_CHACHA20_POLY1305 open (12-byte nonce). Throws on tag mismatch. */
export function openIetf(sealed, aad, nonce12, key) {
  if (sealed.length < 16) throw new Error('aead: ciphertext too short')
  const ciphertext = sealed.subarray(0, sealed.length - 16)
  const tag = sealed.subarray(sealed.length - 16)
  const polyKey = chacha20Block(key, 0, nonce12).subarray(0, 32)
  const aadLength = Buffer.alloc(8)
  aadLength.writeUInt32LE(aad.length, 0)
  const textLength = Buffer.alloc(8)
  textLength.writeUInt32LE(ciphertext.length, 0)
  const expected = poly1305(Buffer.concat([aad, pad16(aad.length), ciphertext, pad16(ciphertext.length), aadLength, textLength]), polyKey)
  let diff = 0
  for (let i = 0; i < 16; i += 1) diff |= expected[i] ^ tag[i]
  if (diff !== 0) throw new Error('aead: authentication failed')
  return chacha20Xor(key, nonce12, 1, ciphertext)
}

/** XChaCha20-Poly1305 seal (24-byte nonce). */
export function sealX(plaintext, aad, nonce24, key) {
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  // The IETF construction takes a 12-byte nonce: four zero bytes then the tail.
  const nonce12 = Buffer.alloc(12)
  nonce24.copy(nonce12, 4, 16, 24)
  return sealIetf(plaintext, aad, nonce12, subkey)
}

/** XChaCha20-Poly1305 open (24-byte nonce). */
export function openX(sealed, aad, nonce24, key) {
  const subkey = hchacha20(key, nonce24.subarray(0, 16))
  const nonce12 = Buffer.alloc(12)
  nonce24.copy(nonce12, 4, 16, 24)
  return openIetf(sealed, aad, nonce12, subkey)
}
