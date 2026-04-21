"""Slack integration: post RCA summaries and handle interactive chat."""
import logging

from app.config import settings

logger = logging.getLogger(__name__)

_SEVERITY_EMOJI = {
    "critical": ":red_circle:",
    "high": ":large_orange_circle:",
    "medium": ":large_yellow_circle:",
    "low": ":white_circle:",
}


class SlackService:
    def __init__(self):
        from slack_sdk.web.async_client import AsyncWebClient
        self.client = AsyncWebClient(token=settings.slack_bot_token)
        self.channel = settings.slack_default_channel

    async def post_investigating(self, incident) -> str | None:
        """Post initial 'investigating...' message. Returns thread_ts."""
        if not settings.slack_bot_token:
            return None
        emoji = _SEVERITY_EMOJI.get(incident.severity, ":white_circle:")
        try:
            resp = await self.client.chat_postMessage(
                channel=self.channel,
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": (
                                f"{emoji} *[{incident.severity.upper()}] {incident.title}*\n"
                                f"Service: `{incident.service_name or 'unknown'}` | "
                                f"Source: {incident.source}\n"
                                f":mag: sre.ai is investigating..."
                            ),
                        },
                    }
                ],
                text=f"[{incident.severity.upper()}] {incident.title} — investigating",
            )
            return resp.get("ts")
        except Exception as e:
            logger.error(f"Failed to post to Slack: {e}")
            return None

    async def post_rca(self, incident, rca) -> None:
        """Post full RCA to Slack thread."""
        if not settings.slack_bot_token:
            return
        emoji = _SEVERITY_EMOJI.get(incident.severity, ":white_circle:")
        confidence_emoji = {"high": ":large_green_circle:", "medium": ":large_yellow_circle:", "low": ":large_red_square:"}.get(rca.confidence, "")

        actions_text = "\n".join(
            f"• *[{a.get('priority', '').upper()}]* {a.get('action', '')}"
            for a in (rca.recommended_actions or [])[:5]
        )

        blocks = [
            {"type": "divider"},
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"{emoji} *Root Cause Analysis Complete*\n"
                        f"{confidence_emoji} Confidence: *{rca.confidence}*\n\n"
                        f"*Root Cause:*\n{rca.root_cause}"
                    ),
                },
            },
        ]

        if rca.summary:
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*Summary:*\n{rca.summary[:2900]}"},
                }
            )

        if actions_text:
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*Recommended Actions:*\n{actions_text}"},
                }
            )

        code = getattr(rca, "code_context", None) or {}
        if code and code.get("snippet"):
            blocks.append({"type": "divider"})
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f":file_folder: *{code.get('file_path', 'unknown')}*"
                        + (f"  ·  `{code.get('class_name', '')}.{code.get('function_name', '')}` line {code.get('line_number', '?')}" if code.get('class_name') else "")
                    ),
                },
            })
            snippet = code.get("snippet", "")[:800]
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*Problematic code:*\n```{snippet}```"},
            })
            if code.get("suggested_fix"):
                fix = code["suggested_fix"][:800]
                blocks.append({
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f"*Suggested fix:*\n```{fix}```"},
                })
            if code.get("change_description"):
                blocks.append({
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f":bulb: {code['change_description']}"},
                })

        if rca.github_pr_url:
            blocks.append(
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f":github: *Fix PR:* <{rca.github_pr_url}|View Pull Request>",
                    },
                }
            )

        try:
            thread_ts = incident.slack_thread_ts
            await self.client.chat_postMessage(
                channel=incident.slack_channel_id or self.channel,
                thread_ts=thread_ts,
                blocks=blocks,
                text=f"RCA: {rca.root_cause}",
            )
        except Exception as e:
            logger.error(f"Failed to post RCA to Slack: {e}")
