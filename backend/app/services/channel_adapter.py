"""
Unified channel adapter — post investigation results to Slack or Discord.
Both adapters implement the same interface so investigation_engine and
slack_events/discord_events can call the same output functions.
"""
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class ChannelAdapter(ABC):
    """Abstract base — one implementation per chat platform."""

    @abstractmethod
    async def post_investigating(self, channel_id: str, title: str, description: str, thread_id: str | None = None) -> str:
        """Post 'investigating...' notice. Returns message_id / thread_id."""

    @abstractmethod
    async def post_rca(self, channel_id: str, thread_id: str | None, rca_data: dict, incident_title: str) -> None:
        """Post the full RCA result (root cause, code context, actions)."""

    @abstractmethod
    async def post_error(self, channel_id: str, thread_id: str | None, message: str) -> None:
        """Post an error notice."""


class SlackAdapter(ChannelAdapter):
    def __init__(self):
        from slack_sdk.web.async_client import AsyncWebClient
        from app.config import settings
        self.client = AsyncWebClient(token=settings.slack_bot_token)

    async def post_investigating(self, channel_id, title, description, thread_id=None) -> str:
        resp = await self.client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_id,
            text=f"🔍 *Investigating*: {title}",
            blocks=[
                {"type": "section", "text": {"type": "mrkdwn", "text": f"🔍 *Investigating incident*: *{title}*\n{description}"}},
                {"type": "context", "elements": [{"type": "mrkdwn", "text": "⏳ sre.ai is running the investigation…"}]},
            ],
        )
        return resp["ts"]

    async def post_rca(self, channel_id, thread_id, rca_data, incident_title):
        from app.services.slack_service import SlackService
        svc = SlackService()

        class _FakeRca:
            def __init__(self, d):
                self.root_cause = d.get("root_cause", "")
                self.confidence = d.get("confidence", "low")
                self.summary = d.get("summary", "")
                self.recommended_actions = d.get("recommended_actions", [])
                self.code_context = d.get("code_context")
                self.needs_pr = d.get("needs_pr", False)
                self.github_pr_url = d.get("github_pr_url")
                self.pr_description = d.get("pr_description")

        class _FakeIncident:
            def __init__(self, t, s):
                self.title = t
                self.service_name = s
                self.id = "discord"
                self.severity = "high"
                self.triggered_at = None

        await svc.post_rca(_FakeIncident(incident_title, ""), _FakeRca(rca_data), thread_ts=thread_id, channel=channel_id)

    async def post_error(self, channel_id, thread_id, message):
        await self.client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_id,
            text=f"❌ Investigation failed: {message[:300]}",
        )


DISCORD_API = "https://discord.com/api/v10"


class DiscordAdapter(ChannelAdapter):
    """Posts messages to Discord channels via bot token (not interaction responses)."""

    def __init__(self):
        import httpx
        from app.config import settings
        self._headers = {
            "Authorization": f"Bot {settings.discord_bot_token}",
            "Content-Type": "application/json",
        }

    async def _post(self, channel_id: str, payload: dict) -> dict:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{DISCORD_API}/channels/{channel_id}/messages",
                json=payload,
                headers=self._headers,
                timeout=10,
            )
            try:
                return resp.json()
            except Exception:
                return {}

    @staticmethod
    def _confidence_color(confidence: str) -> int:
        return {"high": 0x22C55E, "medium": 0xF59E0B, "low": 0xEF4444}.get(confidence, 0x64748B)

    async def post_investigating(self, channel_id, title, description, thread_id=None) -> str:
        data = await self._post(channel_id, {
            "embeds": [{
                "title": f"🔍 Investigating: {title[:100]}",
                "description": description[:2000],
                "color": 0xF59E0B,
                "footer": {"text": "sre.ai · Powered by Groq"},
            }]
        })
        return data.get("id", "")

    async def post_rca(self, channel_id, thread_id, rca_data, incident_title):
        code_ctx = rca_data.get("code_context") or {}
        fields: list[dict] = [
            {"name": "🎯 Root Cause", "value": (rca_data.get("root_cause") or "Unknown")[:1000], "inline": False},
            {"name": "📊 Confidence", "value": (rca_data.get("confidence") or "unknown").title(), "inline": True},
        ]

        if code_ctx.get("file_path"):
            loc = code_ctx["file_path"]
            if code_ctx.get("line_number"):
                loc += f":{code_ctx['line_number']}"
            fields.append({"name": "📁 Location", "value": f"`{loc}`", "inline": True})

        if code_ctx.get("snippet"):
            fields.append({
                "name": "🐛 Problematic Code",
                "value": f"```python\n{code_ctx['snippet'][:800]}\n```",
                "inline": False,
            })

        if code_ctx.get("suggested_fix"):
            fields.append({
                "name": "✅ Suggested Fix",
                "value": f"```python\n{code_ctx['suggested_fix'][:800]}\n```",
                "inline": False,
            })

        if code_ctx.get("change_description"):
            fields.append({
                "name": "💡 What to Change",
                "value": code_ctx["change_description"][:500],
                "inline": False,
            })

        actions = rca_data.get("recommended_actions") or []
        if actions:
            lines = "\n".join(
                f"• **[{a.get('priority','?').upper()}]** {a.get('action','')}"
                for a in actions[:5]
            )
            fields.append({"name": "🛠️ Actions", "value": lines[:1000], "inline": False})

        confidence = rca_data.get("confidence", "low")
        payload = {
            "embeds": [{
                "title": f"📋 RCA Complete: {incident_title[:80]}",
                "color": self._confidence_color(confidence),
                "fields": fields,
                "footer": {"text": "sre.ai · Powered by Groq"},
            }]
        }
        # If there's a PR url, add a button-like field
        if rca_data.get("github_pr_url"):
            payload["embeds"][0]["url"] = rca_data["github_pr_url"]
            payload["embeds"][0]["description"] = f"[🔗 View Fix PR]({rca_data['github_pr_url']})"

        await self._post(channel_id, payload)

    async def post_error(self, channel_id, thread_id, message):
        await self._post(channel_id, {
            "embeds": [{
                "title": "❌ Investigation Failed",
                "description": str(message)[:500],
                "color": 0xEF4444,
                "footer": {"text": "sre.ai"},
            }]
        })
