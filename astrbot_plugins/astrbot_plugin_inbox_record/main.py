"""astrbot_plugin_inbox_record —— 把 AstrBot 收到的每条消息追加进 qq-inbox.jsonl

QQ 侧消息源适配器：写入 dsh-ming-interest 使用的兼容 inbox 格式。
默认路径跟随 DSH_HOME；可在 AstrBot 插件设置中用 inboxPath 覆盖。
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register


def resolve_inbox_path(config: dict | None = None) -> str:
    dsh_home = (
        os.environ.get("DSH_HOME")
        or os.path.join(
            os.environ.get("USERPROFILE") or os.path.expanduser("~"),
            ".dsh",
        )
    )
    configured = (config or {}).get("inboxPath") or (config or {}).get("inbox_path")
    raw_path = str(configured or os.path.join(dsh_home, "media", "onebot", "qq-inbox.jsonl")).strip()
    return os.path.abspath(os.path.expandvars(os.path.expanduser(raw_path)))


@register("astrbot_plugin_inbox_record", "溟", "把入站消息写进 qq-inbox.jsonl，供兴趣唤醒读取", "0.2.0")
class InboxRecord(Star):
    def __init__(self, context: Context, config: dict | None = None):
        super().__init__(context)
        self.config = config or {}
        self.inbox_path = resolve_inbox_path(self.config)
        self._write_lock = asyncio.Lock()
        self._warned = False

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def record(self, event: AstrMessageEvent):
        try:
            gid = event.get_group_id()
            line = {
                "ts": int(time.time() * 1000),
                "kind": "message",
                "decision": {
                    "ok": False,
                    "stage": "inbound",
                    "reason": "兴趣观察：这条进了消息库，没有当作要回复的消息",
                },
                "source": "astrbot",
                "frame": {
                    "message_type": "group" if gid else "private",
                    "group_id": str(gid or ""),
                    "user_id": str(event.get_sender_id() or ""),
                    "self_id": str(event.get_self_id() or ""),
                    "sender": {
                        "card": str(event.get_sender_name() or ""),
                        "nickname": str(event.get_sender_name() or ""),
                    },
                    "message": [
                        {"type": "text", "data": {"text": event.message_str or ""}}
                    ],
                },
            }
            encoded = json.dumps(line, ensure_ascii=False) + "\n"
            async with self._write_lock:
                os.makedirs(os.path.dirname(self.inbox_path), exist_ok=True)
                with open(self.inbox_path, "a", encoding="utf-8") as f:
                    f.write(encoded)
        except Exception as e:  # noqa: BLE001
            if not self._warned:
                logger.warning("[inbox-record] 写入失败（只提示一次）：%s", e)
                self._warned = True
