# dsh-ming-discord

Discord gateway for DeepSeek Harness. It connects Discord messages to DSH Agents and routes Assistant replies back to the originating channel.

## Features

- One persistent DSH Session per Discord server channel; DMs use one Session per Discord user.
- Guild messages require an explicit bot mention by default. DMs are accepted when enabled.
- Uses `ctx.agents` (`resume`, `create`, `followup`, and `steer`) and DSH session events.
- Image attachments are downloaded with a size limit and stored through the DSH attachment service.
- Guild messages are recorded in the legacy OneBot-compatible inbox format so `dsh-ming-interest` can match unmentioned messages.
- Discord user, guild and channel IDs are passed in a message envelope. Configured owner IDs are explicitly marked.
- Bot token is read from `DISCORD_BOT_TOKEN`; no secret belongs in this repository.

## Discord application setup

1. Create an application in the Discord Developer Portal and add a Bot user.
2. Enable the privileged **Message Content Intent**.
3. Invite the bot with View Channels, Send Messages and Read Message History. Administrator permission is unnecessary.
4. Store the bot token as a Windows user environment variable named `DISCORD_BOT_TOKEN`.
5. Restart the DSH process so it inherits the environment variable.

PowerShell example (replace the placeholders locally; never paste the real token into chat or GitHub):

```powershell
[Environment]::SetEnvironmentVariable("DISCORD_BOT_TOKEN", "YOUR_BOT_TOKEN", "User")
[Environment]::SetEnvironmentVariable("MING_OWNER_DISCORD_ID", "YOUR_DISCORD_USER_ID", "User")
```

The owner ID is optional for ordinary chatting, but needed if `dsh-ming-browse` should accept your private-message commands and send its activity report back to your DM. Server-channel messages never control those owner-only switches.

Never paste the bot token into GitHub, chat logs or screenshots.

## Install

Link this directory into the DSH profile as `dsh-ming-discord`, add it to the profile's `dsh.profile.bundles`, install `discord.js` in that profile, and restart DSH. Follow the profile-link pattern in the repository root README.

## Configuration

| Key | Meaning |
|---|---|
| `enabled` | Enable / disable the bridge |
| `workspacePath` | Working directory for newly created Discord sessions |
| `provider`, `model` | Optional explicit model route; otherwise the bridge attempts to reuse a live Agent's route |
| `agentPreset` | Optional DSH Agent preset mounted on each Discord session |
| `mentionRequired` | Guild messages need an @ mention; DMs do not |
| `directMessages` | Accept DMs |
| `allowedGuildIds` | Optional Guild ID allowlist; empty means all guilds |
| `allowedChannelIds` | Optional Channel ID allowlist |
| `ownerUserIds` | Owner Discord IDs, marked in the incoming message envelope |
| `newMessagePolicy` | `steer` interrupts a running turn; `followup` queues the message |
| `maxAttachmentBytes` | Maximum downloaded image size; default 10 MiB |
| `inboxPath`, `chatSessionsPath` | Legacy-compatible inbox and chat-to-session map shared with `dsh-ming-interest` |

## Session mapping

- Server channel: `discord-guild-<guildId>-channel-<channelId>`
- DM: `discord-dm-<userId>`

Different channels and DMs do not share conversation history. Discord threads are separate channels and receive separate sessions.

## Current limitations

- This first integration pass needs runtime verification against the exact DSH version installed in the user's profile.
- Images are handed to the DSH attachment service; other files are passed as their Discord URL and filename for available tools to inspect.
- It does not grant Discord members arbitrary host-command permissions. DSH tool permissions and plugin guardrails remain authoritative.
