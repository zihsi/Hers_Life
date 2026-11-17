/**
 * Message shaping: embeds, buttons, select menus and modals.
 *
 * Discord's message payload is a plain JSON object, so "supporting components"
 * is mostly about building that object correctly and knowing the limits. The
 * builders below validate the limits Discord enforces and throw a readable
 * error instead of letting the API answer 400 Invalid Form Body — a model that
 * gets "embed description is 5000 characters, the limit is 4096" fixes it on
 * the next try; one that gets "400" does not.
 */

export const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  authorName: 256,
  embeds: 10,
  buttonsPerRow: 5,
  rows: 5,
  selectOptions: 25,
  label: 80,
  customIdMax: 100,
  modalTitle: 45,
  modalInputs: 5,
  textInputValue: 4000,
}

/** Component type ids from the Discord API. */
export const COMPONENT = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
}

/** Button styles: 1 primary, 2 secondary, 3 success, 4 danger, 5 link. */
export const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 }

/** Interaction callback types. */
export const INTERACTION_CALLBACK = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
  AUTOCOMPLETE: 8,
  MODAL: 9,
}

/** Interaction types received from the gateway. */
export const INTERACTION_TYPE = { PING: 1, APPLICATION_COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 }

const COLOR = {
  brand: 0x4a7dff,
  green: 0x30a46c,
  red: 0xe5484d,
  amber: 0xf5a524,
  gray: 0x8b8b8b,
}

/** Named colours so tool callers do not have to memorise hex. */
export function color(name) {
  const key = String(name ?? '').trim().toLowerCase()
  if (key === '') return undefined
  if (/^#?[0-9a-f]{6}$/i.test(key)) return parseInt(key.replace('#', ''), 16)
  const named = {
    brand: COLOR.brand, blue: COLOR.brand,
    green: COLOR.green, success: COLOR.green, ok: COLOR.green,
    red: COLOR.red, error: COLOR.red, danger: COLOR.red,
    amber: COLOR.amber, warning: COLOR.amber, warn: COLOR.amber,
    gray: COLOR.gray, grey: COLOR.gray, muted: COLOR.gray,
  }
  return named[key]
}

function clip(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, max - 1) + '…'
}

/**
 * Build one embed.
 *
 * `fields` may be a list of `{name, value, inline}` objects or `[name, value]`
 * pairs; both shapes show up in generated JSON, so accepting both saves a
 * round trip.
 */
export function embed(input = {}) {
  const out = {}
  if (input.title !== undefined && String(input.title).trim() !== '') out.title = clip(input.title, LIMITS.title)
  if (input.description !== undefined && String(input.description).trim() !== '') {
    out.description = clip(input.description, LIMITS.description)
  }
  if (input.url !== undefined && String(input.url).trim() !== '') out.url = String(input.url)
  const tint = color(input.color)
  if (tint !== undefined) out.color = tint
  if (input.timestamp !== undefined && input.timestamp !== null && input.timestamp !== false) {
    out.timestamp = input.timestamp === true ? new Date().toISOString() : String(input.timestamp)
  }
  if (input.author !== undefined) {
    const author = typeof input.author === 'string' ? { name: input.author } : input.author
    out.author = { name: clip(author.name ?? '', LIMITS.authorName) }
    if (author.url !== undefined) out.author.url = String(author.url)
    if (author.icon_url !== undefined) out.author.icon_url = String(author.icon_url)
  }
  if (input.footer !== undefined) {
    const footer = typeof input.footer === 'string' ? { text: input.footer } : input.footer
    out.footer = { text: clip(footer.text ?? '', LIMITS.footer) }
    if (footer.icon_url !== undefined) out.footer.icon_url = String(footer.icon_url)
  }
  if (input.thumbnail !== undefined) out.thumbnail = { url: String(input.thumbnail?.url ?? input.thumbnail) }
  if (input.image !== undefined) out.image = { url: String(input.image?.url ?? input.image) }
  const fields = Array.isArray(input.fields) ? input.fields : []
  if (fields.length > 0) {
    out.fields = fields.slice(0, LIMITS.fields).map((field) => {
      const name = Array.isArray(field) ? field[0] : field?.name
      const value = Array.isArray(field) ? field[1] : field?.value
      return {
        name: clip(name ?? '\u200b', LIMITS.fieldName),
        value: clip(value ?? '\u200b', LIMITS.fieldValue),
        inline: Boolean(Array.isArray(field) ? field[2] : field?.inline),
      }
    })
  }
  return out
}

export function embeds(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, LIMITS.embeds).map((item) => embed(item))
}

/** One button. `customId` is required unless the style is a link. */
export function button(input = {}) {
  const style = Number(input.style ?? (input.url !== undefined ? BUTTON_STYLE.LINK : BUTTON_STYLE.SECONDARY))
  const out = { type: COMPONENT.BUTTON, style, label: clip(input.label ?? '', LIMITS.label) }
  if (style === BUTTON_STYLE.LINK) {
    if (input.url === undefined) throw new Error('link 按钮需要 url')
    out.url = String(input.url)
  } else {
    if (input.custom_id === undefined && input.customId === undefined) throw new Error('按钮需要 custom_id')
    out.custom_id = clip(input.custom_id ?? input.customId, LIMITS.customIdMax)
  }
  if (input.emoji !== undefined) out.emoji = normalizeEmoji(input.emoji)
  if (input.disabled === true) out.disabled = true
  return out
}

/** One action row (a horizontal strip of buttons, or a single select). */
export function row(components = []) {
  const list = components.slice(0, LIMITS.buttonsPerRow)
  return { type: COMPONENT.ACTION_ROW, components: list }
}

/**
 * A select menu. `options` is a list of `{label, value, description?, emoji?}`
 * or plain strings, which become label and value alike.
 */
export function select(input = {}) {
  const kind = String(input.type ?? 'string').toLowerCase()
  const type = {
    string: COMPONENT.STRING_SELECT,
    user: COMPONENT.USER_SELECT,
    role: COMPONENT.ROLE_SELECT,
    mentionable: COMPONENT.MENTIONABLE_SELECT,
    channel: COMPONENT.CHANNEL_SELECT,
  }[kind]
  if (type === undefined) throw new Error('select 的 type 只能是 string/user/role/mentionable/channel')
  const out = {
    type,
    custom_id: clip(input.custom_id ?? input.customId ?? 'select', LIMITS.customIdMax),
    placeholder: clip(input.placeholder ?? '选一个', 150),
  }
  if (input.min_values !== undefined) out.min_values = Number(input.min_values)
  if (input.max_values !== undefined) out.max_values = Number(input.max_values)
  if (input.disabled === true) out.disabled = true
  if (type === COMPONENT.STRING_SELECT) {
    const options = Array.isArray(input.options) ? input.options : []
    if (options.length === 0) throw new Error('string select 需要 options')
    out.options = options.slice(0, LIMITS.selectOptions).map((option) => {
      const value = typeof option === 'string' ? option : option
      const label = typeof option === 'string' ? option : option?.label ?? option?.value
      const built = { label: clip(label ?? '', LIMITS.label), value: clip(value?.value ?? value, 100) }
      if (typeof option === 'object' && option?.description !== undefined) built.description = clip(option.description, 100)
      if (typeof option === 'object' && option?.emoji !== undefined) built.emoji = normalizeEmoji(option.emoji)
      return built
    })
  }
  return out
}

/** Turn `"🔧"` / `":wrench:"` / `{name:"🔧"}` into the API's emoji shape. */
export function normalizeEmoji(input) {
  if (input !== null && typeof input === 'object') {
    const out = {}
    if (input.name !== undefined) out.name = String(input.name)
    if (input.id !== undefined) out.id = String(input.id)
    if (input.animated === true) out.animated = true
    return out
  }
  const text = String(input ?? '').trim()
  const custom = /^<a?:(\w+):(\d+)>$/.exec(text)
  if (custom !== null) return { name: custom[1], id: custom[2], animated: text.startsWith('<a:') }
  const named = /^:([a-z0-9_+-]+):$/i.exec(text)
  if (named !== null) return { name: named[1] }
  return { name: text }
}

/** A modal built from text inputs. */
export function modal(input = {}) {
  const inputs = Array.isArray(input.inputs) ? input.inputs.slice(0, LIMITS.modalInputs) : []
  if (inputs.length === 0) throw new Error('modal 至少需要一个输入框')
  return {
    title: clip(input.title ?? '填写', LIMITS.modalTitle),
    custom_id: clip(input.custom_id ?? input.customId ?? 'modal', LIMITS.customIdMax),
    components: inputs.map((item) => {
      const style = String(item.style ?? 'short').toLowerCase() === 'paragraph' ? 2 : 1
      const field = {
        type: COMPONENT.TEXT_INPUT,
        style,
        label: clip(item.label ?? '内容', 45),
        custom_id: clip(item.custom_id ?? item.customId ?? item.label ?? 'field', LIMITS.customIdMax),
        required: item.required === undefined ? false : Boolean(item.required),
      }
      if (item.placeholder !== undefined) field.placeholder = clip(item.placeholder, 100)
      if (item.value !== undefined) field.value = clip(item.value, LIMITS.textInputValue)
      if (item.max_length !== undefined) field.max_length = Number(item.max_length)
      if (item.min_length !== undefined) field.min_length = Number(item.min_length)
      return { type: COMPONENT.ACTION_ROW, components: [field] }
    }),
  }
}

/**
 * Assemble the full message body. Kept in one place so every caller (tools,
 * bridge, slash commands) produces identically shaped payloads.
 */
export function message(input = {}) {
  const out = {}
  const content = String(input.content ?? input.text ?? '')
  if (content.trim() !== '') out.content = clip(content, LIMITS.content)
  const rich = input.embeds ?? (input.embed === undefined ? [] : [input.embed])
  if (Array.isArray(rich) && rich.length > 0) out.embeds = embeds(rich)
  if (Array.isArray(input.components) && input.components.length > 0) {
    out.components = input.components.slice(0, LIMITS.rows)
  }
  if (input.reply_to !== undefined || input.replyTo !== undefined) {
    out.message_reference = {
      message_id: String(input.reply_to ?? input.replyTo),
      fail_if_not_exists: false,
    }
  }
  if (input.thread_name !== undefined) out.thread_name = clip(input.thread_name, 100)
  if (input.sticker_ids !== undefined) out.sticker_ids = input.sticker_ids
  if (input.tts === true) out.tts = true
  if (input.suppress_embeds === true) out.flags = 4
  if (input.silent === true) out.flags = (out.flags ?? 0) | 4096
  return out
}

/**
 * Group buttons into rows of five. Callers hand over a flat list because that
 * is how a model writes it; the API only accepts rows.
 */
export function buttonRows(buttons) {
  const rows = []
  const list = Array.isArray(buttons) ? buttons.slice(0, LIMITS.rows * LIMITS.buttonsPerRow) : []
  for (let index = 0; index < list.length; index += LIMITS.buttonsPerRow) {
    rows.push(row(list.slice(index, index + LIMITS.buttonsPerRow).map((item) => button(item))))
  }
  return rows
}
