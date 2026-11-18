/**
 * Discord voice channels.
 *
 * A hand-rolled implementation of the voice protocol (gateway v8 + UDP + RTP)
 * so the package needs no native dependencies:
 *
 *   gateway op 4  →  VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE
 *   voice ws      →  Hello, Identify, Ready, IP discovery, SelectProtocol,
 *                    SessionDescription, then encrypted RTP over UDP
 *
 * Encryption uses whichever AEAD the voice server offers: `aead_aes256_gcm_rtpsize`
 * through node:crypto, or `aead_xchacha20_poly1305_rtpsize` through the pure-JS
 * implementation in `aead.js` (this Node build is BoringSSL without ChaCha20).
 * Opus frames come from ffmpeg, using the small Ogg helper next door.
 *
 * DAVE (Discord's end-to-end encryption) is required for non-Stage voice
 * channels: a client that advertises protocol version 0 is closed with 4017.
 * `dave.js` wraps the prebuilt addon; when it cannot be loaded, connection
 * fails before opening the voice socket while text Discord remains available.
 * Stage channels are exempt from DAVE, but no Stage-specific transport path is
 * currently implemented in this adapter.
 */
import { EventEmitter } from 'node:events'
import { createSocket } from 'node:dgram'
import { createCipheriv, createDecipheriv, getCiphers, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { muxOpus, readPackets, audioPackets } from './ogg.js'
import { mixToOgg } from './mixer.js'
import { openX, sealX } from './aead.js'
import { DAVE_OP, DaveSession, loadDavey } from './dave.js'
import { safe } from '../util.js'

const VOICE_OP = {
  IDENTIFY: 0,
  SELECT_PROTOCOL: 1,
  READY: 2,
  HEARTBEAT: 3,
  SESSION_DESCRIPTION: 4,
  SPEAKING: 5,
  HEARTBEAT_ACK: 6,
  RESUME: 7,
  HELLO: 8,
  RESUMED: 9,
  CLIENT_CONNECT: 11,
  CLIENT_DISCONNECT: 12,
  DAVE_PREPARE_TRANSITION: DAVE_OP.PREPARE_TRANSITION,
  DAVE_EXECUTE_TRANSITION: DAVE_OP.EXECUTE_TRANSITION,
  DAVE_PREPARE_EPOCH: DAVE_OP.PREPARE_EPOCH,
}

const RTP_PAYLOAD_TYPE = 120
// The fixed part of an RTP header. Always these twelve bytes, never more: CSRC
// entries and the header extension ride inside the ciphertext, so they are
// added back only after decryption.
const RTP_HEADER_LENGTH = 12
// One-byte extension profile. Two bytes at offset 12 announce the extension;
// the length that follows is in 32-bit words, not bytes.
const HEADER_EXTENSION_PROFILE = Buffer.from([0xbe, 0xde])
const FRAME_MS = 20
const TIMESTAMP_STEP = 960 // 48 kHz × 20 ms, the increment Discord expects
const SILENCE = Buffer.from([0xf8, 0xff, 0xfe])
const MAX_CLIP_MS = 5 * 60_000
// A connection can still be closed on us (channel moved, permissions changed, a
// resumed session the gateway no longer knows). A bounded number of silent
// redials keeps a long sentence going without turning a permanently rejected
// token into an infinite loop.
const MAX_RECONNECTS = 24
// Only used when heartbeats are switched off: how long a silent session is
// allowed to live before we redial on purpose. Measured against a real channel,
// Discord drops a heartbeat-less socket with 4006 after about sixty seconds, so
// the swap is scheduled comfortably before that (and skipped while she is
// mid-sentence) instead of waiting to be cut off.
const KEEP_WARM_MS = 45_000

const HAS_AES_GCM = getCiphers().includes('aes-256-gcm')

/**
 * Pick the encryption mode for this connection. AES-256-GCM goes through
 * node:crypto; XChaCha20-Poly1305 uses the local implementation, which is
 * always available, so both are acceptable.
 */
function pickMode(modes) {
  const offered = Array.isArray(modes) ? modes : []
  if (HAS_AES_GCM && offered.includes('aead_aes256_gcm_rtpsize')) return 'aead_aes256_gcm_rtpsize'
  if (offered.includes('aead_xchacha20_poly1305_rtpsize')) return 'aead_xchacha20_poly1305_rtpsize'
  return null
}

// --------------------------------------------------------------- connection

export class VoiceConnection extends EventEmitter {
  constructor(options) {
    super()
    this.gateway = options.gateway
    this.rest = options.rest
    this.logger = options.logger
    this.ffmpeg = options.ffmpeg ?? 'ffmpeg'
    this.guildId = String(options.guildId)
    this.channelId = String(options.channelId)
    this.userId = String(options.userId)
    this.sessionId = null
    this.token = null
    this.endpoint = null
    this.ws = null
    this.udp = null
    this.state = 'idle'
    this.mode = null
    this.secretKey = null
    this.ssrc = null
    this.localIp = null
    this.localPort = null
    this.sequence = 0
    this.timestamp = 0
    this.nonce = 0
    this.speaking = false
    this.heartbeat = null
    // Heartbeats are opt-in; when off, a keep-warm timer redials instead.
    this.heartbeatEnabled = options.heartbeat !== false
    this.keepWarm = null
    this.seq = -1
    this.playing = null
    this.recording = null
    this.dave = null
    this.connectedClients = new Set()
    // ssrc -> user id, filled from the speaking packets the server forwards so
    // incoming DAVE frames can be decrypted against their sender.
    this.ssrcUser = new Map()
    // Built here, not in `connect()`: `VoiceManager.join()` awaits this promise
    // right after asking the gateway to move us, and at that moment the voice
    // websocket may not exist yet. A `null` here made the await resolve against
    // nothing, so `join()` returned an empty connection while the real
    // handshake was still running.
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.closed = false
    // 4006 redial state: how many silent retries are left, and the pending timer.
    this.reconnects = 0
    this.reconnectTimer = null
  }

  /** Emit without letting one listener's throw become an uncaught exception. */
  emitSafe(name, ...args) {
    for (const listener of this.listeners(name)) {
      try {
        const result = listener.call(this, ...args)
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          Promise.resolve(result).catch((error) => this.logger?.warn('voice listener "' + name + '": ' + String(error?.message ?? error)))
        }
      } catch (error) {
        this.logger?.warn('voice listener "' + name + '" threw: ' + String(error?.message ?? error))
      }
    }
  }

  onVoiceState(data) {
    if (String(data.guild_id) !== this.guildId) return
    const who = String(data.user_id ?? '')
    const where = data.channel_id === null || data.channel_id === undefined ? null : String(data.channel_id)
    if (who !== String(this.userId)) {
      // Somebody else moved. The voice socket only announces people once they
      // start speaking, so a person sitting in the channel and about to answer is
      // invisible there — the gateway state is the only early warning that the
      // room has more than one voice in it.
      if (where !== null && where === String(this.channelId)) {
        this.connectedClients.add(who)
        this.emitSafe('memberJoin', [who])
      } else {
        if (this.connectedClients.delete(who)) this.emitSafe('memberLeave', who)
        // A departing speaker leaves a stale SSRC behind; the next person to be
        // handed that number would be decrypted with the wrong key and read as
        // silence rather than as a new voice.
        for (const [ssrc, known] of this.ssrcUser) {
          if (known === who) this.ssrcUser.delete(ssrc)
        }
      }
      return
    }
    // Being dragged into another voice channel is not an error the caller can
    // see: the old socket is closed by the server (4014) and this object stays
    // in the manager's map with state 'closed', so the next play() reports
    // "not connected" long after the move actually happened. Follow the move.
    const moved = where
    if (moved !== null && moved !== this.channelId && this.state !== 'idle') {
      this.logger?.info('voice: moved to channel ' + moved + ', reconnecting')
      this.channelId = moved
      // Everyone we knew about was in the old channel; the gateway will send a
      // fresh batch for the new one, and keeping the stale names would let her
      // try to answer somebody who is no longer in the room.
      this.connectedClients.clear()
      this.restart()
      return
    }
    if (moved === null && this.state !== 'idle' && this.state !== 'closed') {
      this.logger?.info('voice: disconnected from the channel by someone else')
      this.closed = true
      this.state = 'closed'
      this.closeSocket()
      this.fail(new Error('voice: disconnected externally'))
      return
    }
    if (data.session_id !== undefined && data.session_id !== null) this.sessionId = data.session_id
    this.maybeConnect()
  }

  /**
   * Drop the current gateway/voice session and open a fresh one in the channel
   * we are now in. The old socket is already dead at this point — reusing it
   * would only produce a stream of 4006s.
   */
  restart() {
    if (this.restarting) return
    this.restarting = true
    const run = async () => {
      try {
        this.stopHeartbeat()
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        this.closeSocket()
        this.udp?.close()
        this.udp = null
        this.seq = -1
        this.sequence = 0
        this.timestamp = 0
        this.nonce = 0
        // Keep the voice session identity on purpose. Asking the gateway to move
        // us again only produces a VOICE_STATE_UPDATE, and Discord does not send
        // a fresh VOICE_SERVER_UPDATE for a channel we never left — the redial
        // then waits forever in 'idle'. The existing token is still valid for a
        // redial, so reuse it and fall back to a real rejoin only when that
        // fails.
        this.dave?.destroy?.()
        this.dave = null
        this.connectedClients?.clear()
        this.ssrcUser?.clear()
        this.state = 'idle'
        this.closed = false
        // The ready promise was settled by the previous connection; a new one is
        // needed so the caller can await this join instead of the old one.
        this.ready = new Promise((resolve, reject) => {
          this.readyResolve = resolve
          this.readyReject = reject
        })
        if (this.sessionId !== null && this.token !== null && this.endpoint !== null) {
          await this.connect()
          return
        }
        this.gateway.joinVoice(this.guildId, this.channelId)
      } finally {
        this.restarting = false
      }
    }
    void run().catch((error) => this.fail(error))
  }

  onVoiceServer(data) {
    if (String(data.guild_id) !== this.guildId) return
    this.token = data.token
    this.endpoint = data.endpoint
    this.maybeConnect()
  }

  /**
   * Re-dial after a 4006. Uses the same teardown as a channel move but keeps
   * the connection object, so whoever holds a reference (the tools, the manager)
   * keeps talking to the live socket instead of a corpse.
   */
  scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    const delay = Math.min(8_000, 600 * 2 ** this.reconnects)
    this.reconnects += 1
    this.reconnectTimer = setTimeout(safe(this.logger, 'voice reconnect', () => {
      this.reconnectTimer = null
      if (this.closed) return
      this.logger?.info('voice: reconnecting after 4006 (attempt ' + this.reconnects + ')')
      this.restart()
    }), delay)
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref()
  }

  /** Reset the reconnect budget once a session has been healthy for a while. */
  markHealthy() {
    this.reconnects = 0
  }

  maybeConnect() {
    if (this.state !== 'idle') return
    if (!this.sessionId || !this.token || !this.endpoint) return
    this.connect().catch((error) => this.fail(error))
  }

  async connect() {
    // Discord requires DAVE E2EE for non-Stage voice channels since March 2026.
    // Do not open a socket that advertises no DAVE support: the gateway rejects
    // that connection with 4017, so an unencrypted fallback is not viable.
    const dave = loadDavey(this.logger)
    if (dave === null) {
      throw new Error('voice: DAVE native addon is unavailable; Discord requires DAVE E2EE for voice channels (close 4017). Verify discord/dave/davey.node is present and loadable.')
    }
    this.state = 'connecting'
    this.openedAt = Date.now()
    const url = 'wss://' + String(this.endpoint).replace(/:80$/, '') + '/?v=8'
    this.logger?.info('voice: connecting to ' + this.endpoint)
    const ws = new WebSocket(url)
    this.ws = ws
    // Socket callbacks run outside any await chain; an escaping throw would kill
    // the DSH host process, so each one is wrapped.
    const guard = (label, fn) => safe(this.logger, 'voice ' + label, fn)
    ws.addEventListener('message', guard('message', (event) => {
      if (typeof event.data === 'string') {
        let packet
        try {
          packet = JSON.parse(event.data)
        } catch {
          return
        }
        this.onVoicePacket(packet).catch((error) => this.fail(error))
        return
      }
      // Binary frames carry the MLS blobs. Node's WebSocket hands them over as
      // a Blob, so reading them is asynchronous by nature.
      this.readBinary(event.data)
        .then((buffer) => this.onBinaryFrame(buffer))
        .catch((error) => this.fail(error))
    }))
    ws.addEventListener('close', guard('close', (event) => {
      // A socket we already replaced (channel move, reconnect) must not report a
      // failure for the connection that is now live.
      if (this.ws !== ws) return
      this.stopHeartbeat()
      if (this.closed) return
      this.logger?.warn('voice: socket closed (' + event.code + ') after ' +
        (Date.now() - this.openedAt) + 'ms' + closeHint(event.code))
      this.state = 'closed'
      // Without this the caller waits out the full handshake timeout and then
      // reports "timed out" — a misleading message hiding the real close code.
      this.fail(new Error('voice: socket closed (' + event.code + ')' + closeHint(event.code)))
      this.emitSafe('close', event.code)
      // 4006 means the gateway no longer knows this session. That happens when a
      // resumed session expires, when SelectProtocol is replayed, or when the
      // 4006 came from an earlier bug of ours. Rather than hand the owner a bot
      // that goes deaf mid-sentence, dial back in on its own; a fresh socket
      // buys a fresh session, and the next sentence starts on the new one.
      if (event.code === 4006 && this.reconnects < MAX_RECONNECTS) {
        this.scheduleReconnect()
      }
    }))
    ws.addEventListener('error', guard('error', () => {
      this.logger?.warn('voice: socket error')
    }))
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
    // DAVE was verified before opening the voice socket; identify with the
    // highest protocol version exposed by the bundled native implementation.
    const identify = {
      server_id: this.guildId,
      user_id: this.userId,
      session_id: this.sessionId,
      token: this.token,
    }
    if (dave !== null) identify.max_dave_protocol_version = dave.DAVE_PROTOCOL_VERSION
    this.sendWs({ op: VOICE_OP.IDENTIFY, d: identify })
    return this.ready
  }

  /** Normalise whatever WebSocket binary payload arrives into a Buffer. */
  async readBinary(data) {
    if (Buffer.isBuffer(data)) return data
    if (data instanceof ArrayBuffer) return Buffer.from(data)
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    if (data !== null && typeof data.arrayBuffer === 'function') {
      return Buffer.from(await data.arrayBuffer())
    }
    return null
  }

  /**
   * A DAVE binary frame as it arrives from the server:
   * `[sequence:u16][opcode:u8][payload]`.
   *
   * The sequence header is the trap: reading the opcode from offset 0 always
   * yields 0, so every MLS message is filed under "unknown opcode" and dropped.
   * The group then never assembles, `session.ready` stays false, `encrypt()`
   * degrades to a no-op, and plain Opus goes on the wire to clients that expect
   * a DAVE frame — which they discard. The speaking ring lights up (op 5 was
   * sent) and nobody hears anything, which is exactly how this looked before.
   *
   * Ops 25/26/27/28/31 carry a bare MLS blob; 29 and 30 prefix a transition id.
   * Frames *we* send have no sequence header (see `sendBinary`).
   */
  onBinaryFrame(buffer) {
    if (buffer === null || buffer.length < 3) return
    const seq = buffer.readUInt16BE(0)
    const opcode = buffer.readUInt8(2)
    const payload = buffer.subarray(3)
    // Binary frames carry the same sequence numbers as JSON ones, and the
    // heartbeat's `seq_ack` is supposed to name the last one seen — from either
    // transport. Missing this would make every ack point at a stale position.
    if (Number.isFinite(seq)) this.seq = seq
    this.logger?.debug('voice: binary seq=' + seq + ' op=' + opcode + ' (' + payload.length + ' bytes)')
    const dave = this.dave
    if (dave === null) return
    switch (opcode) {
      case DAVE_OP.MLS_EXTERNAL_SENDER:
        dave.setExternalSender(payload)
        return
      case DAVE_OP.MLS_PROPOSALS:
        dave.processProposals(payload)
        return
      case DAVE_OP.MLS_ANNOUNCE_COMMIT:
        dave.processTransition('commit', payload)
        return
      case DAVE_OP.MLS_WELCOME:
        dave.processTransition('welcome', payload)
        return
      default:
        return
    }
  }

  sendBinary(opcode, payload) {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) return false
    try {
      ws.send(Buffer.concat([Buffer.from([opcode]), payload]))
      return true
    } catch (error) {
      this.logger?.warn('voice: binary send failed — ' + String(error?.message ?? error))
      return false
    }
  }

  async onVoicePacket(packet) {
    if (packet.seq !== undefined) this.seq = packet.seq
    this.logger?.debug('voice: <- op ' + packet.op + (packet.t ? ' ' + packet.t : ''))
    switch (packet.op) {
      case VOICE_OP.HELLO:
        this.startHeartbeat(packet.d.heartbeat_interval)
        return
      case VOICE_OP.HEARTBEAT_ACK:
        return
      case VOICE_OP.READY:
        await this.onReady(packet.d)
        return
      case VOICE_OP.SESSION_DESCRIPTION:
        this.onSessionDescription(packet.d)
        return
      case VOICE_OP.CLIENT_DISCONNECT: {
        const gone = String(packet.d?.user_id ?? '')
        this.connectedClients?.delete(gone)
        // Leave the SSRC mapping behind and a new speaker reusing that number is
        // decrypted with somebody else's key — the frame then fails as a bad tag
        // and the person looks silent instead of looking new.
        for (const [ssrc, known] of this.ssrcUser) {
          if (known === gone) this.ssrcUser.delete(ssrc)
        }
        this.emitSafe('memberLeave', packet.d?.user_id)
        return
      }
      case VOICE_OP.CLIENT_CONNECT:
        for (const id of packet.d?.user_ids ?? []) this.connectedClients?.add(String(id))
        this.emitSafe('memberJoin', packet.d?.user_ids)
        return
      case VOICE_OP.SPEAKING: {
        // The server relays who is talking and with which SSRC. DAVE frames are
        // keyed by user id, so this mapping is required before decrypting.
        const ssrc = Number(packet.d?.ssrc ?? 0)
        const userId = packet.d?.user_id
        if (ssrc !== 0 && userId !== undefined && userId !== null) this.ssrcUser.set(ssrc, String(userId))
        this.emitSafe('speaking', packet.d)
        return
      }
      case VOICE_OP.DAVE_PREPARE_TRANSITION: {
        try {
          const sendReady = this.dave?.prepareTransition(packet.d) ?? false
          if (sendReady) {
            this.sendWs({ op: DAVE_OP.TRANSITION_READY, d: { transition_id: packet.d.transition_id } })
          }
        } catch (error) {
          this.fail(error)
        }
        return
      }
      case VOICE_OP.DAVE_EXECUTE_TRANSITION:
        try {
          this.dave?.executeTransition(packet.d?.transition_id)
        } catch (error) {
          this.fail(error)
        }
        return
      case VOICE_OP.DAVE_PREPARE_EPOCH:
        try {
          this.dave?.prepareEpoch(packet.d)
        } catch (error) {
          this.fail(error)
        }
        return
      default:
        return
    }
  }

  async onReady(data) {
    this.ssrc = data.ssrc
    this.mode = pickMode(data.modes)
    if (this.mode === null) {
      throw new Error('voice: no supported encryption mode offered (' + String(data.modes).slice(0, 120) + ')')
    }
    this.logger?.debug('voice: ready ssrc=' + this.ssrc + ' mode=' + this.mode)
    const udp = createSocket('udp4')
    this.udp = udp
    udp.on('message', safe(this.logger, 'voice udp message', (message) => this.onUdpMessage(message)))
    udp.on('error', (error) => this.logger?.warn('voice udp: ' + String(error)))
    await new Promise((resolve, reject) => {
      udp.bind(0, () => resolve())
      udp.once('error', reject)
    })
    const local = await this.discoverIp(data.ip, data.port)
    this.localIp = local.address
    this.localPort = local.port
    this.logger?.debug('voice: local ' + this.localIp + ':' + this.localPort)
    this.remote = { address: data.ip, port: data.port }
    const sent = this.sendWs({
      op: VOICE_OP.SELECT_PROTOCOL,
      d: { protocol: 'udp', data: { address: this.localIp, port: this.localPort, mode: this.mode } },
    })
    this.logger?.debug('voice: select_protocol -> ' + this.localIp + ':' + this.localPort + ' ' + this.mode + ' (sent=' + sent + ', remote=' + data.ip + ':' + data.port + ')')
  }

  discoverIp(ip, port) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('voice: IP discovery timed out'))
      }, 6000)
      const onMessage = (message) => {
        if (message.length < 74) return
        if (message.readUInt16BE(0) !== 2) return
        // The reply is `type:u16 length:u16 ssrc:u32 address:64s port:u16`, so the
        // port lives in the LAST two bytes — offset 2 holds the length (70). The
        // old code read the port from offset 2, announced "I am on UDP port 70"
        // in SELECT_PROTOCOL, and Discord answered with close code 4006 because
        // nothing was ever going to arrive there.
        const tail = message.length - 2
        const port = message.readUInt16BE(tail)
        const address = message.toString('ascii', 8, tail).replace(/\0.*$/, '')
        cleanup()
        resolve({ address, port })
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.udp.off('message', onMessage)
      }
      this.udp.on('message', onMessage)
      const discovery = Buffer.alloc(74)
      discovery.writeUInt16BE(1, 0)
      discovery.writeUInt16BE(70, 2)
      discovery.writeUInt32BE(this.ssrc, 4)
      this.udp.send(discovery, port, ip)
    })
  }

  onSessionDescription(data) {
    // Discord's Session Description must negotiate a positive DAVE version for
    // this adapter. Stage is an E2EE exception, but Stage transport is not
    // implemented here, so an absent/zero version is a hard failure too.
    const daveVersion = Number(data?.dave_protocol_version ?? 0)
    if (!Number.isInteger(daveVersion) || daveVersion <= 0) {
      this.fail(new Error('voice: Discord did not negotiate DAVE E2EE; refusing unencrypted voice (Stage transport is not implemented)'))
      return
    }
    try {
      this.dave = new DaveSession({
        logger: this.logger,
        userId: this.userId,
        channelId: this.channelId,
        sendBinary: (opcode, payload) => this.sendBinary(opcode, payload),
        sendJson: (packet) => this.sendWs(packet),
      })
      if (!this.dave.available) throw new Error('DAVE native addon is unavailable')
      this.dave.reinit(daveVersion)
    } catch (error) {
      this.fail(error)
      return
    }
    this.secretKey = Buffer.from(data.secret_key)
    this.sequence = randomBytes(2).readUInt16BE(0)
    this.timestamp = randomBytes(4).readUInt32BE(0)
    this.nonce = 0
    this.state = 'ready'
    this.logger?.info('voice: connected to #' + this.channelId + ' (DAVE v' + daveVersion + ')')
    // A session that reached SessionDescription is as healthy as this transport
    // ever gets, so the redial budget starts over on every successful join.
    this.markHealthy()
    this.readyResolve?.(this)
    this.emitSafe('ready')
  }

  // ------------------------------------------------------------- transport

  sendWs(payload) {
    const ws = this.ws
    if (!ws || ws.readyState !== 1) {
      this.logger?.debug('voice: -> op ' + payload.op + ' DROPPED (ws state ' + (ws ? ws.readyState : 'none') + ')')
      return false
    }
    this.logger?.debug('voice: -> op ' + payload.op)
    ws.send(JSON.stringify(payload))
    return true
  }

  startHeartbeat(intervalMs) {
    this.stopHeartbeat()
    if (!this.heartbeatEnabled) {
      // Heartbeats can be switched off entirely. Nothing then keeps the session
      // alive from our side, so the socket is traded for a fresh one before
      // Discord's own deadline instead.
      this.keepWarm = setTimeout(safe(this.logger, 'voice keep warm', () => this.rewarm()), KEEP_WARM_MS)
      if (typeof this.keepWarm.unref === 'function') this.keepWarm.unref()
      return
    }
    const interval = Math.max(5_000, Number(intervalMs) || 41_250)
    const tick = safe(this.logger, 'voice heartbeat', () => {
      // Voice gateway v8 wants an object here, not the bare number that older
      // versions took. From the voice docs: "Since voice gateway version 8,
      // heartbeat messages must include `seq_ack` which contains the sequence
      // number of last numbered message received from the gateway." (`t` is the
      // epoch millisecond nonce echoed back in the ACK.) Sending the old shape
      // to a `?v=8` socket is answered with a 4006 close a couple of hundred
      // milliseconds later, which reads like a phantom timeout — that is what
      // made every heartbeat look lethal.
      this.sendWs({
        op: VOICE_OP.HEARTBEAT,
        d: { t: Date.now(), seq_ack: this.seq },
      })
    })
    // One interval of silence first: Hello is followed by SelectProtocol and the
    // session is not established yet, so an immediate beat only adds noise.
    this.heartbeat = setInterval(tick, interval)
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref()
  }

  /**
   * Trade the current socket for a fresh one before Discord times it out. Only
   * called when heartbeats are off, because that is the mode where the server
   * closes the session on its own schedule.
   */
  rewarm() {
    this.keepWarm = null
    if (this.closed) return
    if (this.state !== 'ready') return
    // Never cut into the middle of a sentence: a redial costs a second of
    // silence, which is fine between sentences and terrible inside one.
    if (this.playing !== null) {
      this.keepWarm = setTimeout(safe(this.logger, 'voice keep warm', () => this.rewarm()), 2_000)
      if (typeof this.keepWarm.unref === 'function') this.keepWarm.unref()
      return
    }
    this.logger?.debug('voice: redialing before Discord times the session out')
    this.restart()
  }

  stopHeartbeat() {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.keepWarm !== null) {
      clearTimeout(this.keepWarm)
      this.keepWarm = null
    }
  }

  /**
   * Build one encrypted RTP packet. The nonce is the 4-byte big-endian counter
   * padded with zeros (12 bytes for AES-GCM, 24 for XChaCha20) and that same
   * counter is appended after the ciphertext, matching the `*_rtpsize` aead
   * transport Discord negotiates.
   */
  buildRtpPacket(opus) {
    // Non-Stage voice is never allowed to fall back to raw Opus. If DAVE
    // has not completed its MLS handshake or encryption fails, drop this frame.
    if (this.dave === null) return null
    const payload = this.dave.encrypt(opus)
    if (payload === null || payload === undefined) return null
    // End-to-end encryption wraps the Opus frame first; the transport cipher
    // below then seals header+payload for the voice server.
    const header = Buffer.alloc(12)
    header[0] = 0x80
    header[1] = RTP_PAYLOAD_TYPE
    this.sequence = (this.sequence + 1) & 0xffff
    header.writeUInt16BE(this.sequence, 2)
    this.timestamp = (this.timestamp + TIMESTAMP_STEP) >>> 0
    header.writeUInt32BE(this.timestamp, 4)
    header.writeUInt32BE(this.ssrc, 8)

    this.nonce = (this.nonce + 1) >>> 0
    const counter = Buffer.alloc(4)
    counter.writeUInt32BE(this.nonce, 0)

    if (this.mode === 'aead_aes256_gcm_rtpsize') {
      const iv = Buffer.alloc(12)
      counter.copy(iv, 0)
      const cipher = createCipheriv('aes-256-gcm', this.secretKey, iv, { authTagLength: 16 })
      cipher.setAAD(header)
      const body = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()])
      return Buffer.concat([header, body, counter])
    }
    const nonce = Buffer.alloc(24)
    counter.copy(nonce, 0)
    return Buffer.concat([header, sealX(payload, header, nonce, this.secretKey), counter])
  }

  /**
   * Where the ciphertext starts, per RFC 3550 §5.1 and Discord's own receiver.
   *
   * The AAD is the fixed 12-byte header plus, when the extension bit is set, the
   * 4-byte extension preamble (`0xBEDE` + a length in 32-bit words). The
   * extension *body* is not in the AAD — discord.js says so plainly: "The
   * unencrypted RTP header contains 12 bytes, HEADER_EXTENSION and the extension
   * size" and "Encrypted contains the extension, if any, the opus packet, and
   * the auth tag". Counting the body here shifts every ciphertext byte and every
   * packet fails with "unable to authenticate data", which surfaces as silence.
   */
  headerLength(message) {
    const first = message[0]
    const csrcCount = first & 0x0f
    let length = RTP_HEADER_LENGTH + csrcCount * 4
    if ((first & 0x10) !== 0) length += 4
    return length
  }

  decryptPacket(message) {
    const headerSize = this.headerLength(message)
    const header = message.subarray(0, headerSize)
    const counter = message.subarray(message.length - 4)
    const body = message.subarray(headerSize, message.length - 4)
    const plain = this.mode === 'aead_aes256_gcm_rtpsize'
      ? this.openGcm(body, header, counter)
      : this.openX(body, header, counter)
    return this.stripHeaderExtension(this.stripPadding(plain, message), message)
  }

  /**
   * Drop the RTP header extension body, which was carried inside the ciphertext.
   *
   * Only the body is in there: the 4-byte preamble (profile `0xBEDE`, then a
   * length in 32-bit words) is already part of the AAD, so the ciphertext starts
   * exactly at the body and the amount to drop is `words * 4` — not
   * `4 + words * 4`. Being four bytes out here leaves DAVE looking for its magic
   * marker at the wrong end of every frame, which it reports as a plain
   * decryption failure. discord.js strips the same amount (`packet.subarray(4 *
   * headerExtensionLength)`), and only the original datagram says whether the
   * extension is there at all.
   */
  stripHeaderExtension(plain, message) {
    if (message.length < 16) return plain
    if (message.subarray(12, 14).compare(HEADER_EXTENSION_PROFILE) !== 0) return plain
    const size = message.readUInt16BE(14) * 4
    if (size === 0 || size >= plain.length) return plain
    return plain.subarray(size)
  }

  openGcm(body, header, counter) {
    const iv = Buffer.alloc(12)
    counter.copy(iv, 0)
    const tag = body.subarray(body.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', this.secretKey, iv, { authTagLength: 16 })
    decipher.setAAD(header)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])
  }

  openX(body, header, counter) {
    const nonce = Buffer.alloc(24)
    counter.copy(nonce, 0)
    return openX(body, header, nonce, this.secretKey)
  }

  /**
   * Drop RTP padding (RFC 3550 §5.1).
   *
   * The padding bytes are inside the encrypted payload, so they only become
   * visible after decryption — and they sit at the very end, exactly where DAVE
   * expects its `0xFAFA` magic marker. Leaving them on turns every padded frame
   * into "not encrypted at all", which davey reports as
   * `UnencryptedWhenPassthroughDisabled`.
   */
  stripPadding(plain, message) {
    if ((message[0] & 0x20) === 0 || plain.length === 0) return plain
    const amount = plain[plain.length - 1]
    if (amount === 0 || amount >= plain.length) return plain
    return plain.subarray(0, plain.length - amount)
  }

  onUdpMessage(message) {
    if (message.length <= 12) return
    // Only RTP version 2 carries voice; anything else is a stray datagram and
    // reading SSRC out of it produces nonsense (this is what discord.js #11449
    // added as a guard after it fed garbage into their DAVE path).
    if (message[0] >> 6 !== 2) return
    const ssrc = message.readUInt32BE(8)
    const payloadType = message[1] & 0x7f
    this.emitSafe('packet', { ssrc, size: message.length })
    // An ear that was opened under a reply and never asked for anything has an
    // expiry: nothing is waiting on those frames, and keeping them forever is a
    // slow leak in a channel that stays open all evening.
    if (this.recording !== null && this.recording.expiresAt > 0 && Date.now() >= this.recording.expiresAt) {
      this.recording = null
      this.emitSafe('recordEnd', { file: '', ms: 0 })
    }
    if (this.recording === null || payloadType !== RTP_PAYLOAD_TYPE) return
    try {
      const framed = this.decryptPacket(message)
      // The transport cipher is peeled off above; DAVE (when the channel uses
      // it) additionally seals the Opus frame with the MLS group key, which is
      // keyed by user rather than by SSRC.
      const user = this.ssrcUser.get(ssrc) ?? null
      // A capture aimed at one person skips everyone else, but only once we know
      // who this SSRC belongs to — dropping a frame because the speaking event
      // has not arrived yet would silently swallow the first sentence.
      if (this.recording.userId !== null && user !== null && user !== this.recording.userId) return
      if (this.dave === null || user === null) return
      const opus = this.dave.decrypt(user, framed)
      if (opus === null) return
      let stream = this.recording.streams.get(ssrc)
      if (stream === undefined) {
        stream = { ssrc, userId: user, packets: [], times: [], lastAt: 0 }
        this.recording.streams.set(ssrc, stream)
      }
      if (stream.packets.length < this.recording.maxPackets) {
        stream.packets.push(opus)
        stream.times.push(Date.now())
      }
      // Kept even after maxPackets is full: "they are still talking" is what
      // tells the caller when to stop, and that stays true past the cap.
      stream.lastAt = Date.now()
    } catch {
      // A corrupt packet is not worth reporting; voice is best-effort.
    }
  }

  setSpeaking(speaking) {
    if (this.speaking === speaking) return
    this.speaking = speaking
    this.sendWs({ op: VOICE_OP.SPEAKING, d: { speaking: speaking ? 1 : 0, delay: 0, ssrc: this.ssrc } })
  }

  sendFrame(opus) {
    if (!this.udp || this.remote === undefined) return false
    const packet = this.buildRtpPacket(opus)
    if (packet === null) return false
    this.udp.send(packet, this.remote.port, this.remote.address)
    return true
  }

  // -------------------------------------------------------------- playback

  /**
   * Speak an audio file (anything ffmpeg can read) into the channel.
   * @param {string} file absolute path
   * @param {{volume?: number, interrupt?: boolean, onProgress?: Function}} options
   */
  async play(file, options = {}) {
    if (this.state !== 'ready') throw new Error('voice: not connected')
    const packets = await this.encode(file, options)
    return this.playPackets(packets, { ...options, label: file })
  }

  /**
   * Play several sources at once.
   *
   * Discord gives one connection one Opus stream, so overlapping `play()` calls
   * is not possible — the second one would cut the first off. Mixing first and
   * pacing the result keeps her able to talk over music instead of instead of it.
   *
   * @param {{file: string, volume?: number, delayMs?: number, offsetMs?: number}[]} tracks
   */
  async playMix(tracks, options = {}) {
    if (this.state !== 'ready') throw new Error('voice: not connected')
    const buffer = await mixToOgg(tracks, {
      ffmpeg: this.ffmpeg,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    return this.playPackets(audioPackets(readPackets(buffer)), { ...options, label: 'mix' })
  }

  /**
   * Send already-encoded Opus packets at the 20 ms cadence Discord expects.
   *
   * Split out of `play()` so a mix and a plain clip share one playback loop:
   * two loops drifting against each other would produce clicks at every
   * hand-over.
   */
  async playPackets(packets, options = {}) {
    if (this.state !== 'ready') throw new Error('voice: not connected')
    if (this.playing !== null) {
      if (options.interrupt === false) return
      this.stopPlayback()
    }
    if (packets.length === 0) return
    const file = String(options.label ?? '')
    const total = packets.length * FRAME_MS
    this.emitSafe('playStart', { file, ms: total })
    // Open the ear before the mouth: the reply takes a second or two to be
    // generated, and a person answers the moment they hear the voice stop. If
    // listening only begins when the turn asks for it, the first word is gone
    // before the recording starts — which is exactly what the owner reported.
    if (this.recording === null) this.startRecording({ auto: true, keepPlaying: true, maxSeconds: 120 })
    this.setSpeaking(true)
    const started = Date.now()
    let index = 0
    await new Promise((resolve) => {
      const timer = setInterval(safe(this.logger, 'voice playback tick', () => {
        if (this.closed || this.state !== 'ready') {
          clearInterval(timer)
          this.playing = null
          this.setSpeaking(false)
          resolve()
          return
        }
        // Pace against the wall clock so a slow encoder does not drift.
        const expected = Math.floor((Date.now() - started) / FRAME_MS) + 1
        while (index < expected && index < packets.length) {
          this.sendFrame(packets[index])
          index += 1
        }
        if (index >= packets.length && expected > packets.length) {
          clearInterval(timer)
          this.playing = null
          // Five frames of silence flush the decoder on the other side.
          let tail = 0
          const drain = setInterval(safe(this.logger, 'voice drain tick', () => {
            this.sendFrame(SILENCE)
            tail += 1
            if (tail >= 5) {
              clearInterval(drain)
              this.setSpeaking(false)
              this.emitSafe('playEnd', { file })
              resolve()
            }
          }), FRAME_MS)
        }
        options.onProgress?.(Math.min(1, index / packets.length))
      }), FRAME_MS / 2)
      this.playing = { timer, file }
    })
  }

  stopPlayback() {
    if (this.playing !== null) {
      clearInterval(this.playing.timer)
      this.playing = null
    }
    this.setSpeaking(false)
  }

  /** Encode a media file to a list of Opus packets with ffmpeg. */
  async encode(file, options = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'hers-voice-'))
    const out = join(dir, 'clip.ogg')
    try {
      const args = ['-hide_banner', '-loglevel', 'error', '-i', file]
      if (options.volume !== undefined && Number(options.volume) !== 1) {
        args.push('-filter:a', 'volume=' + Number(options.volume))
      }
      args.push(
        '-t', String(Math.min(MAX_CLIP_MS / 1000, Number(options.maxSeconds ?? MAX_CLIP_MS / 1000))),
        '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', String(options.bitrate ?? '64k'),
        '-application', 'voip', '-frame_duration', '20',
        '-y', out,
      )
      await runProcess(this.ffmpeg, args, 120_000)
      const buffer = await readFile(out)
      return audioPackets(readPackets(buffer))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // ------------------------------------------------------------- recording

  /**
   * Who is in this channel right now, by id.
   *
   * `ssrcUser` only fills in when somebody starts speaking, so a person who has
   * not said a word yet is invisible to it — and "listen to whoever is talking"
   * has to include the quiet one who is about to answer. The voice socket's
   * CLIENTS_CONNECT batch and the gateway's voice states are the only places
   * that know, and both feed this set.
   * @returns {string[]}
   */
  channelMembers() {
    return [...this.connectedClients]
  }

  /**
   * Capture what is being said. Audio is stashed as Opus packets and muxed to
   * an Ogg file on stop, so the result plays in any Discord client.
   *
   * Frames are kept per sender. Locking onto the first SSRC that arrives looks
   * reasonable until you notice that the first thing a busy channel produces is
   * somebody else's silence — the recording then holds two seconds of a frame
   * every 150 ms and misses the person who was actually talking. Ogg also cannot
   * interleave two independent Opus streams, so the streams have to stay apart
   * until the end, where the long one wins.
   * @param {{userId?: string, maxSeconds?: number}} options
   */
  startRecording(options = {}) {
    // `keepPlaying` lets a recording start *underneath* what is already being
    // said. Starting to listen only after the reply finishes means the opening
    // word of the answer is gone: a round trip through the model costs a second
    // or two, and a person starts talking the moment the voice stops.
    if (this.playing !== null && options.keepPlaying !== true) this.stopPlayback()
    const maxSeconds = Math.min(MAX_CLIP_MS / 1000, Number(options.maxSeconds ?? 120))
    const existing = this.recording
    // Adopt the recording that was already running underneath the reply: it has
    // been capturing since before the first word, and throwing it away to start
    // a fresh one is exactly how the first syllable gets lost.
    if (existing !== null && options.adopt === true && existing.auto === true) {
      // The caller now decides who is being listened to; an auto capture starts
      // with no filter at all, so "nobody named" means "everybody", not "keep
      // whatever the last turn asked for".
      existing.userId = options.userId === undefined ? null : String(options.userId)
      existing.maxPackets = Math.max(existing.maxPackets, Math.floor((maxSeconds * 1000) / FRAME_MS))
      // Somebody is waiting on it now, so the "nobody has spoken yet" grace
      // period starts here rather than when the reply began.
      existing.waitedFrom = Date.now()
      existing.auto = false
      existing.expiresAt = 0
      return existing
    }
    this.recording = {
      userId: options.userId === undefined ? null : String(options.userId),
      ssrc: null,
      packets: [],
      streams: new Map(),
      maxPackets: Math.floor((maxSeconds * 1000) / FRAME_MS),
      started: Date.now(),
      waitedFrom: Date.now(),
      // A recording opened by the reply itself, before anybody asked for one.
      // It has to stay open through silence: the whole point is to be already
      // running when the owner starts talking, and "nobody said anything yet"
      // is the expected state, not a reason to stop.
      auto: options.auto === true,
      // An automatic one is nobody's turn yet, so it needs its own expiry:
      // otherwise a channel nobody answers leaves a silent capturer holding a
      // few thousand Opus frames until the process restarts.
      expiresAt: options.auto === true ? Date.now() + 300_000 : 0,
    }
    this.emitSafe('recordStart')
    return this.recording
  }

  /**
   * True once the captured audio has gone quiet, or the cap is reached.
   *
   * Waiting out a fixed window is what made her feel slow to answer: a three
   * second sentence was followed by twelve seconds of nothing before she even
   * started thinking. The recogniser does not need the trailing silence — it
   * needs the sentence — so the caller can stop as soon as the room is quiet,
   * which is also what the reference clients do.
   * @param {{quietMs?: number}} options
   */
  recordingFinished(options = {}) {
    const recording = this.recording
    if (recording === null) return true
    const quietMs = Math.max(300, Number(options.quietMs ?? 2_000))
    const now = Date.now()
    let picked = null
    if (recording.userId !== null) {
      for (const stream of recording.streams.values()) {
        if (stream.userId !== recording.userId) continue
        if (picked === null || stream.packets.length > picked.packets.length) picked = stream
      }
    }
    if (picked === null) {
      for (const stream of recording.streams.values()) {
        if (picked === null || stream.packets.length > picked.packets.length) picked = stream
      }
    }
    if (picked === null || picked.packets.length === 0) {
      // Nobody has said anything yet. Do not call that "finished" after the
      // quiet window — a silent channel right after joining is normal, and the
      // person is usually still drawing breath. `waitedFrom` is used rather than
      // `started` because an opened-under-the-reply capture has been running for
      // a while already; counting that time would end it before anyone spoke.
      if (recording.expiresAt !== undefined && recording.expiresAt > 0 && now >= recording.expiresAt) return true
      return now - (recording.waitedFrom ?? recording.started) >= Math.max(quietMs, 8_000)
    }
    if (picked.packets.length >= recording.maxPackets) return true
    return now - picked.lastAt >= quietMs
  }

  async stopRecording() {
    const recording = this.recording
    this.recording = null
    if (recording === null) return null
    // When a caller names somebody, that person wins even with fewer packets:
    // a busy channel produces far more frames from whoever talks most, and the
    // whole point of naming someone is to hear *them*, not the loudest stream.
    let picked = null
    if (recording.userId !== null) {
      for (const stream of recording.streams.values()) {
        if (stream.userId !== recording.userId) continue
        if (picked === null || stream.packets.length > picked.packets.length) picked = stream
      }
    }
    if (picked === null) {
      // Otherwise the longest stream is the one somebody spoke into; the others
      // are husks that only carried heartbeats of silence.
      for (const stream of recording.streams.values()) {
        if (picked === null || stream.packets.length > picked.packets.length) picked = stream
      }
    }
    if (picked === null || picked.packets.length === 0) return null
    const saved = await this.saveStream(picked)
    this.emitSafe('recordEnd', { file: saved.file, ms: saved.ms })
    return {
      file: saved.file,
      ms: saved.ms,
      packets: saved.packets,
      ssrc: picked.ssrc,
      userId: picked.userId,
      streams: recording.streams.size,
      // Everything that arrived, so the caller can say "only one other person
      // was talking" instead of guessing why the words are not the expected ones.
      heard: [...recording.streams.values()].map((stream) => ({ userId: stream.userId, frames: stream.packets.length })),
    }
  }

  /**
   * Save one stream to its own Ogg file.
   *
   * Pulled out of `stopRecording` because a group call needs every speaker kept
   * apart: one file per voice, so each transcript can be attributed to the
   * person who actually said it.
   */
  async saveStream(stream) {
    const packets = this.padTimeline(stream)
    const ogg = muxOpus(packets, { vendor: 'dsh-hers-life' })
    const dir = await mkdtemp(join(tmpdir(), 'hers-record-'))
    const file = join(dir, 'recording.ogg')
    await writeFile(file, ogg)
    const times = stream.times ?? []
    return {
      file,
      ms: packets.length * FRAME_MS,
      packets: packets.length,
      // The window this voice actually occupied. Callers need it to notice that
      // two people were talking over each other: a transcript of overlapping
      // speech is half somebody else's words, and nothing in the text says so.
      firstAt: times.length === 0 ? 0 : times[0],
      lastAt: times.length === 0 ? 0 : times[times.length - 1],
    }
  }

  /**
   * Stop and keep *everybody* who spoke, one file per person.
   *
   * A voice channel is not a phone call: three people can answer a question and
   * a fourth can cut in halfway through. Picking a single "best" stream throws
   * all of that away, and the person who was edged out by a louder talker never
   * learns their sentence was never heard. `minMs` drops the households that only
   * ever sent a lone frame (a muted mic, a moan of packet loss).
   * @param {{minMs?: number}} options
   */
  async stopRecordingAll(options = {}) {
    const recording = this.recording
    this.recording = null
    if (recording === null) return []
    const minMs = Math.max(FRAME_MS, Number(options.minMs ?? 400))
    const speakers = []
    for (const stream of recording.streams.values()) {
      const ms = stream.packets.length * FRAME_MS
      if (ms < minMs) continue
      const saved = await this.saveStream(stream)
      speakers.push({ ...saved, ssrc: stream.ssrc, userId: stream.userId, times: stream.times ?? [] })
    }
    // In saying order, so the transcript reads like the conversation happened.
    speakers.sort((a, b) => a.firstAt - b.firstAt)
    // Mark who was talking at the same time as whom, and how badly.
    //
    // A group transcript is not improved by naming the speakers: when two people
    // talk over each other the recogniser, given one stream per person, still
    // produces words that belong to neither. Knowing *how much* of a sentence
    // was buried is the difference between "he said this" and "some of this is
    // his" — and only the caller can decide to ask again instead of answering.
    const slots = new Map()
    for (const speaker of speakers) slots.set(speaker, new Set(speaker.times))
    for (const speaker of speakers) {
      let buried = 0
      for (const slot of speaker.times) {
        for (const other of speakers) {
          if (other === speaker) continue
          const theirs = slots.get(other)
          // A frame is "buried" when somebody else sent one within the same
          // 20 ms slot; ±1 slot covers the jitter between two sockets.
          if (theirs.has(slot) || theirs.has(slot - FRAME_MS) || theirs.has(slot + FRAME_MS)) {
            buried += 1
            break
          }
        }
      }
      speaker.overlap = speakers
        .filter((other) => other !== speaker && other.firstAt < speaker.lastAt && speaker.firstAt < other.lastAt)
        .map((other) => other.userId)
        .filter((id) => id !== null && id !== undefined)
      speaker.buriedRatio = speaker.times.length === 0 ? 0 : buried / speaker.times.length
    }
    if (speakers.length > 0) this.emitSafe('recordEnd', { file: speakers[0].file, ms: speakers[0].ms })
    return speakers.map(({ packets, times, ...rest }) => rest)
  }

  /**
   * Rebuild the gaps between packets with silence.
   *
   * A voice that arrives in bursts (push-to-talk, a muted mic between
   * sentences, packets lost on the way) was being glued together at a flat
   * 20 ms spacing. The duration then looks plausible while the audio is played
   * back at the wrong speed — every silence of a second became a click, and the
   * recogniser, given time-compressed syllables, answers "no words heard at
   * all". Filling the holes costs a few hundred Opus frames and makes the file
   * sound like what the channel actually sounded like.
   */
  padTimeline(stream) {
    const times = stream.times ?? []
    if (times.length < 2) return stream.packets
    const silence = SILENCE
    const padded = []
    // Cap the fill so a lone packet from five minutes ago cannot become a file
    // of pure silence; 2 s is longer than any pause inside a sentence.
    const MAX_FILL = Math.round(2_000 / FRAME_MS)
    for (let index = 0; index < stream.packets.length; index += 1) {
      if (index > 0) {
        const gap = times[index] - times[index - 1]
        const missing = Math.round(gap / FRAME_MS) - 1
        if (missing > 0) {
          const count = Math.min(MAX_FILL, missing)
          for (let filler = 0; filler < count; filler += 1) padded.push(silence)
        }
      }
      padded.push(stream.packets[index])
    }
    return padded
  }

  // ---------------------------------------------------------------- teardown

  /**
   * Drop the socket without telling the gateway we are leaving.
   *
   * `leave()` performs a real departure (gateway op 4 with a null channel);
   * this one is for reconnects, where we want to stay in the channel but the
   * transport is dead. The generation guard in the close handler keeps the old
   * socket's close event from interfering with the new one.
   */
  closeSocket() {
    const socket = this.ws
    this.ws = null
    if (!socket) return
    try {
      socket.close(4000)
    } catch {
      /* already gone */
    }
  }

  async leave() {
    if (this.closed) return
    this.closed = true
    this.stopPlayback()
    this.stopHeartbeat()
    try {
      this.udp?.close()
    } catch {
      /* ignore */
    }
    this.udp = null
    try {
      this.ws?.close(1000)
    } catch {
      /* ignore */
    }
    this.ws = null
    this.state = 'closed'
    this.gateway?.leaveVoice(this.guildId)
    if (this.recording !== null) await this.stopRecording().catch(() => {})
    this.dave?.destroy()
    this.dave = null
    this.readyReject?.(new Error('voice: left the channel'))
    this.emitSafe('close', 1000)
  }

  fail(error) {
    if (this.closed || this.state === 'failed') return
    const reason = error instanceof Error ? error : new Error(String(error))
    this.logger?.warn('voice: ' + String(reason.message ?? reason))
    this.state = 'failed'
    this.closed = true
    this.stopPlayback()
    this.stopHeartbeat()
    try { this.udp?.close() } catch {}
    this.udp = null
    const socket = this.ws
    this.ws = null
    try { socket?.close(4000) } catch {}
    try { this.gateway?.leaveVoice(this.guildId) } catch {}
    try { this.dave?.destroy() } catch {}
    this.dave = null
    // Wake whoever is still awaiting the handshake instead of letting them sit
    // until VoiceManager.join()'s 20 s timeout reports the wrong reason.
    this.readyReject?.(reason)
    this.emitSafe('error', reason)
  }
}

/**
 * Explain the close codes that are not self-explanatory.
 *
 * 4017 in particular reads like a network error but means the opposite: the
 * handshake reached Discord and was refused because the client did not claim
 * DAVE support.
 */
function closeHint(code) {
  if (code === 4017) return ' — Discord requires DAVE end-to-end encryption; the addon did not load'
  if (code === 4014) return ' — disconnected: kicked, or the voice channel permissions changed'
  if (code === 4006) return ' — session is no longer valid, rejoin the channel'
  if (code === 4004) return ' — voice token rejected, reconnect the bot'
  return ''
}

function runProcess(command, args, timeoutMs) {  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(command + ' timed out'))
    }, timeoutMs)
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(command + ' exited with ' + code + (stderr.trim() === '' ? '' : ': ' + stderr.trim().slice(0, 400))))
    })
  })
}

/**
 * One connection per guild, plus the `joinVoice` conveniences the tools use.
 */
export class VoiceManager {
  constructor(options) {
    this.gateway = options.gateway
    this.rest = options.rest
    this.settings = options.settings
    this.logger = options.logger
    this.connections = new Map()
    this.selfId = null
  }

  setSelfId(id) {
    this.selfId = id
  }

  onVoiceState(data) {
    for (const connection of this.connections.values()) connection.onVoiceState(data)
  }

  onVoiceServer(data) {
    for (const connection of this.connections.values()) connection.onVoiceServer(data)
  }

  async join(guildId, channelId) {
    const key = String(guildId)
    const existing = this.connections.get(key)
    if (existing !== undefined && existing.channelId === String(channelId) &&
      existing.state !== 'failed' && existing.state !== 'closed') {
      // A rejected promise here may be a transient reconnect; only reuse a
      // connection that still owns a live transport state.
      await existing.ready.catch(() => existing.ready)
      return existing
    }
    if (existing !== undefined) await this.leave(guildId)
    const connection = new VoiceConnection({
      gateway: this.gateway,
      rest: this.rest,
      logger: this.logger,
      ffmpeg: this.settings.resolve().ffmpeg,
      guildId: key,
      channelId: String(channelId),
      userId: this.selfId,
      heartbeat: this.settings.get('voice.heartbeat', true) === true,
    })
    this.connections.set(key, connection)
    this.gateway.joinVoice(key, String(channelId))
    const timer = setTimeout(() => {
      if (connection.state !== 'ready') {
        connection.fail(new Error('voice: handshake timed out'))
      }
    }, 20_000)
    try {
      await connection.ready
    } finally {
      clearTimeout(timer)
    }
    return connection
  }

  async leave(guildId) {
    const key = String(guildId)
    const connection = this.connections.get(key)
    if (connection === undefined) return
    this.connections.delete(key)
    await connection.leave()
  }

  get(guildId) {
    return this.connections.get(String(guildId)) ?? null
  }

  list() {
    return [...this.connections.values()].map((connection) => ({
      guildId: connection.guildId,
      channelId: connection.channelId,
      state: connection.state,
      mode: connection.mode,
      playing: connection.playing !== null,
      recording: connection.recording !== null,
    }))
  }

  async destroy() {
    for (const key of [...this.connections.keys()]) await this.leave(key)
  }
}

export { VOICE_OP, RTP_PAYLOAD_TYPE, FRAME_MS }
