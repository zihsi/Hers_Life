/**
 * Slash commands and interaction replies.
 *
 * A bot that only reacts to messages is half a bot: `/help` works without
 * knowing the channel id, buttons are how you answer a question in one tap, and
 * a modal is the only way to collect multi-line text in Discord. This module
 * owns all three so the bridge stays about conversation.
 *
 * Design notes:
 * - Commands are declared once in `COMMANDS` and registered per guild when the
 *   plugin starts. Guild scope applies instantly, which matters when you are
 *   editing the bot and want to see the change now.
 * - Every handler answers within three seconds. Longer work defers first and
 *   then edits the original response — missing that window makes Discord show
 *   "This interaction failed" and there is no way to fix it afterwards.
 * - Everything is wrapped by the caller in `safe`, because interaction handlers
 *   run from gateway callbacks where a throw becomes a process exit.
 */
import { INTERACTION_CALLBACK, INTERACTION_TYPE, message as buildMessage } from './components.js'

/**
 * The commands she exposes. `run` receives `{ interaction, option, reply, follow }`
 * and returns a string (sent as the reply) or a message body object.
 *
 * Deliberately small: this is the discoverable surface, not the whole capability
 * set — she reaches the rest through tools.
 */
export const COMMANDS = [
  {
    name: 'ask',
    description: '直接问她一句话（不用 @）',
    options: [
      { type: 3, name: 'text', description: '要问的内容', required: true },
    ],
  },
  {
    name: 'say',
    description: '让她在指定频道说一句话',
    options: [
      { type: 3, name: 'text', description: '要说的内容', required: true },
      { type: 7, name: 'channel', description: '目标频道（默认当前）', required: false },
    ],
  },
  {
    name: 'memory',
    description: '查看她记得的事',
    options: [
      { type: 3, name: 'query', description: '搜索关键词（留空看最近的）', required: false },
    ],
  },
  {
    name: 'status',
    description: '她现在是什么状态',
  },
  {
    name: 'voice',
    description: '语音频道控制',
    options: [
      { type: 3, name: 'action', description: '进来 / 离开', required: true,
        choices: [{ name: '进来', value: 'join' }, { name: '离开', value: 'leave' }] },
      { type: 7, name: 'channel', description: '要进哪个语音频道（默认你所在的）', required: false },
    ],
  },
  // Context menus. These show up in the right-click menu on a message, which is
  // the only way to point at *that* message without copy-pasting it. A message
  // command carries `target_id` plus the resolved message, so no extra fetch is
  // needed and it works on messages older than the bot's cache.
  //
  // The ASCII name is what Discord validates; the localisations are what people
  // actually read. Putting Chinese in `name` also works but a single rejected
  // char fails the whole PUT and every command disappears with it.
  {
    type: 3,
    name: 'peek',
    description: '把这条消息交给她，让她接着聊',
    nameLocalizations: { 'zh-TW': '讓她看這段', 'zh-CN': '让她看这段', ja: 'これを見て' },
  },
  {
    type: 3,
    name: 'remember',
    description: '把这条消息写进她记得的事',
    nameLocalizations: { 'zh-TW': '記下來', 'zh-CN': '记下来', ja: '覚えておいて' },
  },
]

/**
 * Context-menu handlers are declared here so the bridge only has to supply the
 * behaviour, not the Discord plumbing.
 */
export const MENU_COMMANDS = ['peek', 'remember']

/** Command payload shape for the API: strips our internal `run` etc. */
export function commandPayloads(commands = COMMANDS) {
  return commands.map((command) => {
    const kind = Number(command.type ?? 1)
    // A context menu has no options, and sending any gets the whole PUT
    // rejected with 50035, taking every other command down with it.
    const out = { name: command.name, type: kind }
    if (command.nameLocalizations !== undefined) out.name_localizations = command.nameLocalizations
    if (kind !== 1) return out
    out.description = command.description
    if (command.descriptionLocalizations !== undefined) out.description_localizations = command.descriptionLocalizations
    if (Array.isArray(command.options) && command.options.length > 0) {
      out.options = command.options.map((option) => {
        const built = {
          type: option.type,
          name: option.name,
          description: option.description,
          required: Boolean(option.required),
        }
        if (option.choices !== undefined) built.choices = option.choices
        return built
      })
    }
    return out
  })
}

/**
 * Interaction plumbing.
 *
 * Holds the application id so replies can use the webhook follow-up route, and
 * routes each interaction to the right handler. `handlers` is a map from
 * `commandName` → async function, plus optional `component:<custom_id>` and
 * `modal:<custom_id>` entries — that is how a button the model sent can call
 * back into the bridge.
 */
export class Interactions {
  constructor(options) {
    this.rest = options.rest
    this.logger = options.logger
    this.applicationId = String(options.applicationId ?? '')
    this.handlers = new Map()
    this.onUnknown = options.onUnknown ?? null
    this.events = options.events ?? null
  }

  setApplicationId(id) {
    this.applicationId = String(id ?? '')
  }

  handle(name, fn) {
    this.handlers.set(String(name), fn)
    return () => this.handlers.delete(String(name))
  }

  /**
   * One gateway INTERACTION_CREATE.
   *
   * Interaction types: 1 ping, 2 application command, 3 component (button /
   * select), 4 autocomplete, 5 modal submit.
   */
  async dispatch(interaction) {
    if (interaction === null || interaction === undefined) return
    const id = String(interaction.id ?? '')
    const token = String(interaction.token ?? '')
    if (id === '' || token === '') return
    const type = Number(interaction.type)

    if (type === INTERACTION_TYPE.PING) {
      await this.rest.interactionCallback(id, token, { type: INTERACTION_CALLBACK.PONG })
      return
    }

    const user = interaction.member?.user ?? interaction.user ?? {}
    const summary =
      type === INTERACTION_TYPE.APPLICATION_COMMAND
        ? '/' + String(interaction.data?.name ?? '?') + ' — ' + (user.global_name ?? user.username ?? user.id ?? '?')
        : type === INTERACTION_TYPE.MODAL_SUBMIT
          ? '表单 ' + String(interaction.data?.custom_id ?? '?')
          : '点了 ' + String(interaction.data?.custom_id ?? '?')
    this.events?.push('INTERACTION_CREATE', summary, { id, userId: String(user.id ?? '') })

    if (type === INTERACTION_TYPE.AUTOCOMPLETE) {
      // Answer with the plain option list rather than letting Discord spin.
      const focused = (interaction.data?.options ?? []).find((option) => option.focused)?.value ?? ''
      await this.rest.interactionCallback(id, token, {
        type: INTERACTION_CALLBACK.AUTOCOMPLETE,
        data: { choices: String(focused) === '' ? [] : [{ name: String(focused).slice(0, 100), value: String(focused) }] },
      }).catch(() => {})
      return
    }

    const key =
      type === INTERACTION_TYPE.APPLICATION_COMMAND
        ? String(interaction.data?.name ?? '')
        : type === INTERACTION_TYPE.MODAL_SUBMIT
          ? 'modal:' + String(interaction.data?.custom_id ?? '')
          : 'component:' + String(interaction.data?.custom_id ?? '')
    const handler = this.handlers.get(key)
      ?? (key.startsWith('component:') ? this.handlers.get('component') : undefined)

    // Acknowledge immediately: three seconds is the hard limit and a handler
    // that does network work will blow through it.
    let deferred = false
    const reply = async (body) => {
      const payload = typeof body === 'string' ? { content: body } : body
      if (deferred) return this.rest.followup(this.applicationId, token, payload)
      if (deferred === 'pending') {
        // The deferred answer already went out; the first follow-up edits it.
        deferred = 'done'
        return this.rest.request('PATCH', '/webhooks/' + this.applicationId + '/' + token + '/messages/@original', { body: payload })
      }
      return this.rest.interactionCallback(id, token, { type: INTERACTION_CALLBACK.CHANNEL_MESSAGE, data: payload })
    }
    const defer = async (ephemeral = false) => {
      const result = await this.rest.interactionCallback(id, token, {
        type: INTERACTION_CALLBACK.DEFERRED_CHANNEL_MESSAGE,
        data: ephemeral ? { flags: 64 } : {},
      }).catch(() => null)
      deferred = result === null ? false : 'pending'
      return deferred !== false
    }

    if (handler === undefined) {
      await this.rest.interactionCallback(id, token, {
        type: INTERACTION_CALLBACK.CHANNEL_MESSAGE,
        data: { content: '这个交互没有对应的处理逻辑（' + key + '）。', flags: 64 },
      }).catch(() => {})
      this.logger?.debug('unhandled interaction ' + key)
      return
    }

    try {
      const result = await handler({
        interaction,
        type,
        key,
        user,
        option: (name) => optionValue(interaction, name),
        options: () => collectOptions(interaction),
        reply,
        defer,
        modal: (body) => this.rest.interactionCallback(id, token, { type: INTERACTION_CALLBACK.MODAL, data: body }),
        update: (body) => this.rest.interactionCallback(id, token, {
          type: INTERACTION_CALLBACK.UPDATE_MESSAGE,
          data: typeof body === 'string' ? { content: body } : body,
        }),
      })
      if (result !== undefined && result !== null && deferred === false) {
        await reply(result).catch(() => {})
      }
    } catch (error) {
      this.logger?.warn('interaction ' + key + ' failed: ' + String(error?.stack ?? error?.message ?? error))
      const detail = String(error?.message ?? error).slice(0, 300)
      await reply({ content: '（她这边出错了：' + detail + '）', flags: 64 }).catch(() => {})
    }
  }
}

/** Read one option out of an interaction's data. */
export function optionValue(interaction, name) {
  const list = interaction?.data?.options ?? []
  for (const option of list) {
    if (option.name !== name) continue
    return option.value ?? option.options?.[0]?.value ?? undefined
  }
  return undefined
}

/** All options as a flat object, including subcommand options one level down. */
export function collectOptions(interaction) {
  const out = {}
  const walk = (list) => {
    for (const option of list ?? []) {
      if (Array.isArray(option.options)) walk(option.options)
      else out[option.name] = option.value
    }
  }
  walk(interaction?.data?.options)
  return out
}

/**
 * Register commands for one guild. Global registration takes up to an hour to
 * propagate, which is useless while iterating; guild scope is instant.
 */
export async function registerCommands(rest, applicationId, guildId, commands = COMMANDS) {
  const payload = commandPayloads(commands)
  if (guildId !== undefined && guildId !== null && String(guildId) !== '') {
    return rest.setGuildCommands(applicationId, String(guildId), payload)
  }
  return rest.setGlobalCommands(applicationId, payload)
}

/** Message body with buttons, for the common "answer with a choice" case. */
export function withButtons(content, buttons) {
  return buildMessage({ content, components: buttons })
}
