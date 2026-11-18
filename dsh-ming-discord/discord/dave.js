/**
 * DAVE — Discord's end-to-end encryption for voice.
 *
 * Since March 2, 2026, Discord requires DAVE for non-Stage voice calls:
 * identifying with `max_dave_protocol_version: 0` (or omitting the field) is
 * rejected with close code 4017. Stage channels are the documented exception. The protocol itself (MLS group state, key schedules, media AEAD) is
 * far too large to hand-write, so this wraps the already-compiled
 * `@snazzah/davey` native addon that ships next to this file.
 *
 * The addon is an N-API module, so the same binary works under both the plain
 * Node build and Electron's embedded Node. It is loaded lazily and every
 * failure is reported to the voice caller. A missing binary must not take down
 * text Discord, but it makes non-Stage voice-channel joining unavailable.
 *
 * Wire format (voice gateway v8):
 *   JSON op 21 dave_prepare_transition      -> op 23 dave_transition_ready
 *   JSON op 22 dave_execute_transition
 *   JSON op 24 dave_prepare_epoch
 *   binary op 25 external sender            (payload is the raw MLS blob)
 *   binary op 26 key package                (we send this ourselves)
 *   binary op 27 proposals                  -> binary op 28 commit/welcome
 *   binary op 29 announce commit            -> op 23 ready
 *   binary op 30 welcome                    -> op 23 ready
 *   binary op 31 invalid commit/welcome     (we send on a failed commit)
 *
 * Binary frames are `[opcode:1][payload]`. For ops 29/30 the first two bytes of
 * the payload are the transition id; key packages and proposals have no id.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

export const DAVE_OP = {
  PREPARE_TRANSITION: 21,
  EXECUTE_TRANSITION: 22,
  TRANSITION_READY: 23,
  PREPARE_EPOCH: 24,
  MLS_EXTERNAL_SENDER: 25,
  MLS_KEY_PACKAGE: 26,
  MLS_PROPOSALS: 27,
  MLS_COMMIT_WELCOME: 28,
  MLS_ANNOUNCE_COMMIT: 29,
  MLS_WELCOME: 30,
  MLS_INVALID_COMMIT: 31,
}

const HERE = dirname(fileURLToPath(import.meta.url))
const NATIVE = join(HERE, 'dave', 'davey.node')

/**
 * Whether a frame still carries DAVE's magic marker.
 *
 * The last two bytes of a sealed frame are `0xFAFA`; the reference client uses
 * the same test to tell ciphertext from a plain Opus packet that needs no work.
 */
export function isSealed(frame) {
  return frame.length >= 3 && frame[frame.length - 1] === 0xfa && frame[frame.length - 2] === 0xfa
}

let cached = null
let cachedError = null

/**
 * Load the native addon once.
 *
 * Returns `null` when it is unavailable (not shipped, wrong arch, blocked by
 * policy) and remembers why. Non-Stage Discord voice channels require DAVE, so
 * callers must fail clearly rather than attempting an unencrypted fallback.
 */
export function loadDavey(logger = null) {
  if (cached !== null || cachedError !== null) return cached
  try {
    if (!existsSync(NATIVE)) throw new Error('native module missing at ' + NATIVE)
    const require = createRequire(import.meta.url)
    const native = require(NATIVE)
    if (typeof native?.DAVESession !== 'function') throw new Error('addon exposes no DAVESession')
    cached = native
    logger?.info('dave: native addon loaded (protocol v' + native.DAVE_PROTOCOL_VERSION + ')')
    return cached
  } catch (error) {
    cachedError = error
    logger?.warn('dave: unavailable; non-Stage voice channels cannot connect without DAVE — ' + String(error?.message ?? error))
    return null
  }
}

/**
 * One participant's MLS state for one voice channel.
 *
 * Mirrors the state machine of the reference client so the server sees the
 * usual sequence: key package → external sender → proposals/commit → transition.
 */
export class DaveSession {
  constructor(options) {
    this.logger = options.logger ?? null
    this.userId = String(options.userId)
    this.channelId = String(options.channelId)
    this.sendBinary = options.sendBinary
    this.sendJson = options.sendJson
    this.native = loadDavey(this.logger)
    this.session = null
    this.protocolVersion = 0
    this.pendingTransitions = new Map()
    this.lastTransitionId = null
    this.degraded = false
  }

  get available() {
    return this.native !== null
  }

  /** Whether audio must be run through `encrypt`/`decrypt` right now. */
  get active() {
    return this.session !== null && this.protocolVersion > 0 && this.session.ready === true
  }

  /** Highest protocol version the addon speaks; 0 when there is no addon. */
  maxProtocolVersion() {
    return this.native?.DAVE_PROTOCOL_VERSION ?? 0
  }

  /** Create (or recreate) the MLS session and hand the key package to the server. */
  reinit(protocolVersion) {
    const version = Number(protocolVersion)
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error('DAVE protocol version 0 would disable end-to-end encryption; plaintext voice fallback is disabled (Stage transport is not implemented)')
    }
    if (!this.available) return
    this.protocolVersion = version
    if (this.session === null) {
      this.session = new this.native.DAVESession(protocolVersion, this.userId, this.channelId)
      this.logger?.debug('dave: session created for protocol v' + protocolVersion)
    } else {
      this.session.reinit(protocolVersion, this.userId, this.channelId)
      this.logger?.debug('dave: session reinitialised for protocol v' + protocolVersion)
    }
    this.sendKeyPackage()
  }

  sendKeyPackage() {
    if (this.session === null) return
    try {
      const keyPackage = this.session.getSerializedKeyPackage()
      if (keyPackage !== null && keyPackage.length > 0) {
        this.sendBinary(DAVE_OP.MLS_KEY_PACKAGE, Buffer.from(keyPackage))
      }
    } catch (error) {
      this.logger?.warn('dave: key package failed — ' + String(error?.message ?? error))
    }
  }

  setExternalSender(payload) {
    if (this.session === null) return
    try {
      this.session.setExternalSender(Buffer.from(payload))
      this.logger?.debug('dave: external sender accepted')
    } catch (error) {
      this.logger?.warn('dave: external sender rejected — ' + String(error?.message ?? error))
    }
  }

  /** op 24: the server announces an epoch. 1 means "establish the group now". */
  prepareEpoch(data) {
    const epoch = Number(data?.epoch ?? 0)
    const version = Number(data?.protocol_version ?? this.protocolVersion)
    this.logger?.debug('dave: prepare epoch ' + epoch + ' (v' + version + ')')
    if (epoch === 1) this.reinit(version)
  }

  /** op 21: a version/group switch is coming. Returns whether to answer op 23. */
  prepareTransition(data) {
    const id = Number(data?.transition_id ?? 0)
    const version = Number(data?.protocol_version ?? this.protocolVersion)
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error('DAVE transition requested protocol version 0; refusing unencrypted voice fallback')
    }
    this.pendingTransitions.set(id, version)
    this.logger?.debug('dave: prepare transition ' + id + ' (v' + version + ')')
    // The addon must be told about the transition before it will hand out keys.
    // Skipping this leaves `ready` false forever even though the group is
    // assembled, which is exactly how audio ended up sent in plaintext.
    this.prepareNative(id, version)
    if (id === 0) {
      // Transition 0 is the initial "you are in the group" switch; it applies
      // immediately and the server does not expect a ready acknowledgement.
      this.executeTransition(0)
      return false
    }
    return true
  }

  /** Hand the transition to the addon without letting a throw break the socket. */
  prepareNative(id, version) {
    if (this.session === null) return
    try {
      this.session.prepareTransition(id, version)
      this.logger?.debug('dave: native prepare ' + id + ' (v' + version + ')')
    } catch (error) {
      this.logger?.warn('dave: native prepare ' + id + ' failed — ' + String(error?.message ?? error))
    }
  }

  /** op 22 (or the synthetic id 0 above). Returns whether state actually moved. */
  executeTransition(transitionId) {
    const id = Number(transitionId)
    if (!this.pendingTransitions.has(id)) {
      this.logger?.debug('dave: execute transition ' + id + ' had no pending entry')
      return false
    }
    const next = Number(this.pendingTransitions.get(id))
    if (!Number.isInteger(next) || next <= 0) {
      this.pendingTransitions.delete(id)
      throw new Error('DAVE execute transition requested protocol version 0; refusing unencrypted voice fallback')
    }
    const previous = this.protocolVersion
    this.protocolVersion = next
    // The addon switches epochs here; its return value says whether a prepared
    // transition existed. Without this call the keys never become usable.
    let moved = false
    if (this.session !== null) {
      try {
        moved = this.session.executeTransition(id) === true
      } catch (error) {
        this.logger?.warn('dave: native execute ' + id + ' failed — ' + String(error?.message ?? error))
      }
    }
    if (id > 0 && this.degraded) {
      this.degraded = false
      this.logger?.info('dave: end-to-end encryption restored')
    }
    this.lastTransitionId = id
    this.pendingTransitions.delete(id)
    this.logger?.debug('dave: transition ' + id + ' executed (v' + previous + ' -> v' + next
      + ', native=' + moved + ', ready=' + (this.session?.ready === true) + ')')
    return true
  }

  /** binary op 27: someone joined; we may need to publish a commit. */
  processProposals(payload) {
    if (this.session === null) return
    const buffer = Buffer.from(payload)
    if (buffer.length < 1) return
    const operation = buffer.readUInt8(0)
    try {
      const result = this.session.processProposals(operation, buffer.subarray(1), null)
      const commit = result?.commit ?? null
      if (commit === null || commit === undefined) return
      const welcome = result?.welcome ?? null
      const framed = welcome === null || welcome === undefined
        ? Buffer.from(commit)
        : Buffer.concat([Buffer.from(commit), Buffer.from(welcome)])
      this.sendBinary(DAVE_OP.MLS_COMMIT_WELCOME, framed)
      this.logger?.debug('dave: commit sent (' + framed.length + ' bytes)')
    } catch (error) {
      this.logger?.warn('dave: proposals failed — ' + String(error?.message ?? error))
    }
  }

  /**
   * binary op 29 (commit) and op 30 (welcome).
   *
   * Both carry a transition id in the first two bytes; on success the server
   * expects us to acknowledge with op 23, except for the synthetic id 0.
   */
  processTransition(kind, payload) {
    if (this.session === null) return
    const buffer = Buffer.from(payload)
    if (buffer.length < 2) return
    const transitionId = buffer.readUInt16BE(0)
    const body = buffer.subarray(2)
    try {
      if (kind === 'commit') this.session.processCommit(body)
      else this.session.processWelcome(body, null)
      // Both paths must hand the transition to the addon: the docs say
      // "Afterwards, prepare the transition with prepareTransition to start
      // using the new keys". Acknowledging the server without this leaves the
      // group ACTIVE and still unable to encrypt, so audio goes out in
      // plaintext and every listener silently drops it.
      this.prepareNative(transitionId, this.protocolVersion)
      if (transitionId === 0) {
        this.lastTransitionId = 0
      } else {
        this.pendingTransitions.set(transitionId, this.protocolVersion)
        this.sendJson({ op: DAVE_OP.TRANSITION_READY, d: { transition_id: transitionId } })
      }
      this.logger?.debug('dave: ' + kind + ' processed (transition ' + transitionId
        + ', ready=' + (this.session?.ready === true) + ')')
    } catch (error) {
      this.logger?.warn('dave: ' + kind + ' rejected — ' + String(error?.message ?? error))
      this.sendJson({ op: DAVE_OP.MLS_INVALID_COMMIT, d: { transition_id: transitionId } })
      this.reinit(this.protocolVersion)
    }
  }

  /** Run one Opus frame through the group cipher (no-op while inactive). */
  encrypt(opus) {
    if (!this.active) return opus
    try {
      return Buffer.from(this.session.encryptOpus(opus))
    } catch (error) {
      this.logger?.warn('dave: encrypt failed — ' + String(error?.message ?? error))
      return opus
    }
  }

  /**
   * Decrypt one frame from another member.
   *
   * Returns `null` when the frame cannot be read yet (the sender is on another
   * epoch, or the group is mid-transition) — the caller drops it rather than
   * feeding noise to the decoder.
   */
  decrypt(userId, opus) {
    if (this.session === null) return opus
    // Discord's silence frame is not encrypted and must never be handed to the
    // group cipher (the reference client skips it for the same reason).
    if (opus.length <= 3 && opus[opus.length - 1] === 0xfe && opus[opus.length - 2] === 0xff) return opus
    const sealed = isSealed(opus)
    if (!this.active) {
      // Keys are not usable yet. Ciphertext is unreadable, so dropping it is
      // honest; plaintext only gets through when nobody encrypted it.
      return sealed ? null : opus
    }
    try {
      return Buffer.from(this.session.decrypt(String(userId), this.native.MediaType.AUDIO, opus))
    } catch (error) {
      this.logger?.debug('dave: drop frame from ' + userId + ' — ' + String(error?.message ?? error))
      return null
    }
  }

  destroy() {
    try {
      this.session?.reset?.()
    } catch {
      /* the addon is already gone */
    }
    this.session = null
    this.pendingTransitions.clear()
  }
}
