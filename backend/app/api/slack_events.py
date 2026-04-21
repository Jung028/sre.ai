"""
Slack Events API endpoint.

Receives:
  - URL verification challenges (during Slack app setup)
  - app_mention events  (@sre-ai investigate payment-service)
  - message events in subscribed channels (alert messages trigger auto-investigation)

Setup in Slack App dashboard:
  Event Subscriptions URL: https://your-domain.com/api/slack/events
  Subscribe to: app_mention, message.channels
"""
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.incident import Alert, Incident
from app.services.alert_normalizer import NormalizedAlert

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/slack", tags=["slack"])

# Keywords that indicate an alert message (not a normal chat message)
ALERT_KEYWORDS = ["alert", "incident", "error", "latency", "spike", "outage", "down", "degraded", "slo", "p99", "p95"]


def _verify_slack_signature(request_body: bytes, timestamp: str, signature: str) -> bool:
    """Verify request actually came from Slack."""
    if not settings.slack_signing_secret:
        return True  # skip in dev
    # Reject old timestamps (replay attack prevention)
    if abs(time.time() - float(timestamp)) > 300:
        return False
    sig_basestring = f"v0:{timestamp}:{request_body.decode()}"
    computed = "v0=" + hmac.new(
        settings.slack_signing_secret.encode(),
        sig_basestring.encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


@router.post("/events")
async def slack_events(request: Request, background_tasks: BackgroundTasks):
    """Main Slack Events API handler."""
    body_bytes = await request.body()

    # Verify Slack signature
    ts = request.headers.get("X-Slack-Request-Timestamp", "0")
    sig = request.headers.get("X-Slack-Signature", "")
    if not _verify_slack_signature(body_bytes, ts, sig):
        return Response(content="Unauthorized", status_code=401)

    payload = json.loads(body_bytes)

    # 1. URL verification challenge (one-time during app setup)
    if payload.get("type") == "url_verification":
        return {"challenge": payload["challenge"]}

    # 2. Event callback
    if payload.get("type") == "event_callback":
        event = payload.get("event", {})
        event_type = event.get("type", "")

        # Ignore bot's own messages to prevent loops
        if event.get("bot_id") or event.get("subtype") == "bot_message":
            return {"ok": True}

        text = event.get("text", "").strip()
        channel = event.get("channel", "")
        thread_ts = event.get("thread_ts") or event.get("ts")

        if event_type == "app_mention":
            # @sre-ai investigate payment-service / @sre-ai <alert text>
            # Strip the mention prefix
            import re
            text = re.sub(r"<@[A-Z0-9]+>", "", text).strip()
            background_tasks.add_task(
                _handle_slack_alert, text, channel, thread_ts, source="slack_mention"
            )

        elif event_type in ("message", "message.channels"):
            # Auto-detect alert messages by keywords
            text_lower = text.lower()
            if any(kw in text_lower for kw in ALERT_KEYWORDS):
                background_tasks.add_task(
                    _handle_slack_alert, text, channel, thread_ts, source="slack_channel"
                )

    return {"ok": True}


async def _handle_slack_alert(text: str, channel: str, thread_ts: str, source: str):
    """Create an incident from a Slack message and run investigation."""
    # Parse service name from text (look for known patterns)
    service_name = _extract_service_name(text)

    alert = NormalizedAlert(
        source=source,
        external_id=f"slack-{uuid.uuid4().hex[:8]}",
        title=text[:255] if text else "Slack Alert",
        severity=_detect_severity(text),
        service_name=service_name,
        description=text,
        labels={"channel": channel},
        fired_at=datetime.now(timezone.utc),
        runbook_url=None,
        raw={"text": text, "channel": channel},
    )

    async with AsyncSessionLocal() as db:
        incident_id = str(uuid.uuid4())
        incident = Incident(
            id=incident_id,
            source=source,
            external_id=alert.external_id,
            title=alert.title,
            severity=alert.severity,
            status="investigating",
            service_name=service_name,
            triggered_at=alert.fired_at,
            slack_thread_ts=thread_ts,
            slack_channel_id=channel,
            raw_payload={
                "normalized": {
                    "source": source,
                    "external_id": alert.external_id,
                    "title": alert.title,
                    "severity": alert.severity,
                    "service_name": service_name,
                    "description": text,
                    "labels": {"channel": channel},
                    "fired_at": alert.fired_at.isoformat(),
                    "runbook_url": None,
                },
                "original": {"text": text},
            },
        )
        db.add(incident)
        db.add(Alert(
            id=str(uuid.uuid4()),
            incident_id=incident_id,
            source=source,
            title=alert.title,
            description=text,
            labels={"channel": channel},
            fired_at=alert.fired_at,
        ))
        await db.commit()

    # Post "investigating" message to Slack thread
    if settings.slack_bot_token:
        try:
            from slack_sdk.web.async_client import AsyncWebClient
            client = AsyncWebClient(token=settings.slack_bot_token)
            severity_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "⚪"}.get(alert.severity, "🔵")
            await client.chat_postMessage(
                channel=channel,
                thread_ts=thread_ts,
                text=(
                    f"{severity_emoji} *sre.ai is investigating...*\n"
                    f"Service: `{service_name or 'unknown'}` | Severity: *{alert.severity}*\n"
                    f"I'll post the full RCA + code fix here when done."
                ),
            )
        except Exception as e:
            logger.error(f"Failed to post investigating message: {e}")

    # Run investigation (publishes SSE + posts RCA to Slack when done)
    from app.workers.tasks import _run_investigation
    await _run_investigation(incident_id)


def _extract_service_name(text: str) -> str | None:
    """Extract service name from alert text using common patterns."""
    import re
    # Match: "payment-service", "auth_service", "order-svc"
    patterns = [
        r"\b([\w-]+-service)\b",
        r"\b([\w-]+-svc)\b",
        r"service[:\s]+`?([\w-]+)`?",
        r"`([\w-]+)`",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).lower()
    return None


def _detect_severity(text: str) -> str:
    """Detect severity from alert text keywords."""
    text_lower = text.lower()
    if any(w in text_lower for w in ["critical", "p0", "sev0", "down", "outage", "fatal"]):
        return "critical"
    if any(w in text_lower for w in ["high", "p1", "sev1", "error", "spike", "breach"]):
        return "high"
    if any(w in text_lower for w in ["medium", "p2", "warning", "degraded", "slow"]):
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Slack Slash Command: /agent
# ---------------------------------------------------------------------------
# Register in Slack App → Slash Commands:
#   Command: /agent
#   Request URL: https://your-domain.com/api/slack/commands
#   Description: Trigger sre.ai investigation or check status

@router.post("/commands")
async def slack_slash_command(request: Request, background_tasks: BackgroundTasks):
    """Handle /agent slash command from Slack."""
    from fastapi.responses import JSONResponse

    body_bytes = await request.body()
    ts = request.headers.get("X-Slack-Request-Timestamp", "0")
    sig = request.headers.get("X-Slack-Signature", "")
    if not _verify_slack_signature(body_bytes, ts, sig):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    # Slack sends slash commands as form-encoded data
    from urllib.parse import parse_qs
    form = parse_qs(body_bytes.decode())
    command = form.get("command", [""])[0]
    text = form.get("text", [""])[0].strip()
    channel_id = form.get("channel_id", [""])[0]
    user_name = form.get("user_name", [""])[0]
    response_url = form.get("response_url", [""])[0]

    if command != "/agent":
        return {"response_type": "ephemeral", "text": f"Unknown command: {command}"}

    parts = text.split(None, 1)
    sub = parts[0].lower() if parts else "help"
    arg = parts[1] if len(parts) > 1 else ""

    # /agent help
    if sub == "help" or not sub:
        return {
            "response_type": "ephemeral",
            "text": (
                "*sre.ai Agent Commands*\n"
                "• `/agent investigate <description>` — trigger AI investigation\n"
                "• `/agent status` — list active investigations\n"
                "• `/agent help` — show this message\n\n"
                "You can also @mention the bot in any channel or let it auto-detect alert keywords."
            ),
        }

    # /agent status
    if sub == "status":
        from app.database import AsyncSessionLocal
        from app.models.incident import Incident
        from sqlalchemy import desc, select

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Incident)
                .where(Incident.status == "investigating")
                .order_by(desc(Incident.triggered_at))
                .limit(5)
            )
            active = result.scalars().all()

        if not active:
            return {"response_type": "ephemeral", "text": "✅ No active investigations."}

        lines = [f"• *{i.title[:60]}* — `{i.service_name}` [{i.severity.upper()}]" for i in active]
        return {
            "response_type": "in_channel",
            "text": "🔥 *Active Investigations:*\n" + "\n".join(lines),
        }

    # /agent investigate <description>
    if sub == "investigate":
        if not arg:
            return {"response_type": "ephemeral", "text": "❌ Usage: `/agent investigate <what's wrong>`"}

        background_tasks.add_task(
            _handle_slack_alert, arg, channel_id, None, source="slack_command"
        )
        return {
            "response_type": "in_channel",
            "text": f"🔍 *{user_name}* triggered an investigation:\n> {arg[:200]}\n\nI'll post the RCA here when done.",
        }

    return {"response_type": "ephemeral", "text": f"Unknown subcommand: `{sub}`. Try `/agent help`."}
