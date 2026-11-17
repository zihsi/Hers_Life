/**
 * Just enough Ogg to move Opus frames in and out of ffmpeg.
 *
 * Discord voice wants one raw Opus packet per 20 ms RTP payload. ffmpeg only
 * muxes Opus inside Ogg, so we parse the container on the way out (speaking)
 * and write one on the way in (listening). Both directions only ever handle
 * single-stream, single-logical-bitstream files, which is all Opus voice needs.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i << 24
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0 ? (value << 1) ^ 0x04c11db7 : value << 1
    }
    table[i] = value
  }
  return table
})()

function crc32(buffer, start, length) {
  let crc = 0
  for (let i = start; i < start + length; i += 1) {
    crc = (crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ buffer[i]]
  }
  return crc >>> 0
}

/** Opus identification header: 48 kHz stereo, no channel mapping table. */
export function opusHead(channels = 2) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head[8] = 1
  head[9] = channels
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  head.writeUInt16LE(0, 16)
  head[18] = 0
  return head
}

/** Opus comment header with a single vendor string and no user comments. */
export function opusTags(vendor = 'dsh-hers-life') {
  const name = Buffer.from(vendor, 'utf8')
  const tags = Buffer.alloc(16 + name.length)
  tags.write('OpusTags', 0, 'ascii')
  tags.writeUInt32LE(name.length, 8)
  name.copy(tags, 12)
  tags.writeUInt32LE(0, 12 + name.length)
  return tags
}

/**
 * Serialize one page. `segments` is the lacing table (values 0-255); the data
 * length must equal the sum of `segments`.
 */
export function buildPage({ serial, sequence, granule, headerType, segments, data }) {
  const header = Buffer.alloc(27 + segments.length)
  header.write('OggS', 0, 'ascii')
  header[4] = 0
  header[5] = headerType
  header.writeBigUInt64LE(BigInt(granule ?? 0), 6)
  header.writeUInt32LE(serial >>> 0, 14)
  header.writeUInt32LE(sequence >>> 0, 18)
  header.writeUInt32LE(0, 22)
  header[26] = segments.length
  for (let i = 0; i < segments.length; i += 1) header[27 + i] = segments[i]
  const page = Buffer.concat([header, data])
  page.writeUInt32LE(crc32(page, 0, page.length), 22)
  return page
}

/** Lacing table for a list of packet lengths (each packet ends with a <255 lacing value). */
export function lacing(packetLengths) {
  const segments = []
  for (const length of packetLengths) {
    let remaining = length
    while (remaining >= 255) {
      segments.push(255)
      remaining -= 255
    }
    segments.push(remaining)
  }
  return segments
}

/**
 * Mux a list of Opus packets into a complete single-page-group Ogg stream.
 * `granule` is the final granule position (samples at 48 kHz).
 */
export function muxOpus(packets, options = {}) {
  const serial = options.serial ?? 0x4d494e47
  const preSkip = options.preSkip ?? 312
  const pages = []
  let sequence = 0

  const head = opusHead(options.channels ?? 2)
  pages.push(buildPage({
    serial, sequence: sequence++, granule: 0, headerType: 0x02, segments: lacing([head.length]), data: head,
  }))

  const tags = opusTags(options.vendor)
  pages.push(buildPage({
    serial, sequence: sequence++, granule: 0, headerType: 0, segments: lacing([tags.length]), data: tags,
  }))

  // One page per packet keeps granule positions exact and playback pacing simple.
  let granule = preSkip
  for (const packet of packets) {
    granule += 960
    pages.push(buildPage({
      serial, sequence: sequence++, granule, headerType: 0, segments: lacing([packet.length]), data: packet,
    }))
  }
  return Buffer.concat(pages)
}

/**
 * Walk an Ogg stream and yield every completed packet.
 * @param {Buffer} buffer complete file bytes
 * @returns {Buffer[]} packets in stream order (including OpusHead/OpusTags)
 */
export function readPackets(buffer) {
  const packets = []
  let offset = 0
  let pending = []
  let pendingLength = 0

  while (offset + 27 <= buffer.length) {
    if (buffer.toString('ascii', offset, offset + 4) !== 'OggS') {
      // Resynchronise: skip a byte and try again (handles junk from ffmpeg warnings).
      offset += 1
      continue
    }
    const segmentCount = buffer[offset + 26]
    const tableStart = offset + 27
    if (tableStart + segmentCount > buffer.length) break
    const segments = []
    let payloadLength = 0
    for (let i = 0; i < segmentCount; i += 1) {
      const value = buffer[tableStart + i]
      segments.push(value)
      payloadLength += value
    }
    const payloadStart = tableStart + segmentCount
    if (payloadStart + payloadLength > buffer.length) break

    let cursor = payloadStart
    for (const segment of segments) {
      pending.push(buffer.subarray(cursor, cursor + segment))
      pendingLength += segment
      cursor += segment
      if (segment < 255) {
        packets.push(Buffer.concat(pending, pendingLength))
        pending = []
        pendingLength = 0
      }
    }
    offset = payloadStart + payloadLength
  }
  return packets
}

/**
 * Strip the two header packets from a parsed Opus Ogg stream.
 * @param {Buffer[]} packets
 * @returns {Buffer[]} audio packets ready to become RTP payloads
 */
export function audioPackets(packets) {
  const start = packets.findIndex((packet) => packet.length >= 8 && packet.toString('ascii', 0, 4) === 'Opus')
  if (start < 0) return packets
  return packets.slice(start + 2)
}

export { crc32 }
