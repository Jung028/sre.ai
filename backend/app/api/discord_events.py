"""
Discord Interactions endpoint.

Setup:
1. Create Discord Application at https://discord.com/developers/applications
2. Add a Bot, copy DISCORD_BOT_TOKEN
3. Copy DISCORD_PUBLIC_KEY and DISCORD_APPLICATION_ID
4. Set Interactions Endpoint URL to: https://your-domain.com/api/discord/interactions
5. Call POST /api/discord/register-commands to register the /agent slash command
6. Invite bot with scopes: bot + applications.commands

Environment vars needed:
  DISCORD_BOT_TOKEN
  DISCORD_APPLICATION_ID
  DISCORD_PUBLIC_KEY
"""
import json
import logging
import re

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.services.channel_adapter import DiscordAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/discord", tags=["discord"])

DISCORD_API = "https://discord.com/api/v10"
ALERT_KEYWORDS = re.compile(
    r"\b(alert|incident|outage|error|latency|spike|degraded|p99|p95|slo|down|crash|oom|timeout|5xx|500)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Signature verification (Ed25519 via PyNaCl)
# ---------------------------------------------------------------------------

async def _verify_discord_request(request: Request) -> bytes:
    body = await request.body()
    public_key = settings.discord_public_key
    if not public_key:
        return body  # dev mode — skip verification

    signature = request.headers.get("X-Signature-Ed25519", "")
    timestamp = request.headers.get("X-Signature-Timestamp", "")

    try:
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError  # type: ignore

        verify_key = VerifyKey(bytes.fromhex(public_key))
        verify_key.verify(timestamp.encode() + body, bytes.fromhex(signature))
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid Discord signature: {exc}")

    return body


# ---------------------------------------------------------------------------
# Helpers — send follow-up to an interaction token
# ---------------------------------------------------------------------------

async def _patch_interaction_response(application_id: str, token: str, payload: dict):
    url = f"{DISCORD_API}/webhooks/{application_id}/{token}/messages/@original"
    async with httpx.AsyncClient() as client:
        resp = await client.patch(url, json=payload, headers={"Authorization": f"Bot {settings.discord_bot_token}"}, timeout=10)
        if resp.status_code >= 400:
            logger.warning("Discord followup failed %s: %s", resp.status_code, resp.text[:200])


# ---------------------------------------------------------------------------
# Background investigation runner
# ---------------------------------------------------------------------------

async def _run_investigation_discord(
    channel_id: str,
    description: str,
    application_id: str | None = None,
    interaction_token: str | None = None,
):
    """Create incident + run AI investigation + post RCA to Discord channel."""
    from app.database import AsyncSessionLocal
    from app.models.incident import Alert, Incident
    from app.services.alert_normalizer import AlertNormalizer
    from app.services.investigation_engine import InvestigationEngine

    adapter = DiscordAdapter()

    # Extract service name heuristically
    service_match = re.search(
        r'\b([\w-]+(?:-service|-api|-gateway|-worker|-db|-cache))\b', description, re.IGNORECASE
    )
    service_name = service_match.group(1).lower() if service_match else "unknown-service"

    thread_id = None

    async with AsyncSessionLocal() as db:
        incident = Incident(
            title=description[:200],
            service_name=service_name,
            severity=_detect_severity(description),
            status="investigating",
            source="discord",
            raw_payload={"description": description, "channel_id": channel_id},
        )
        db.add(incident)
        alert = Alert(incident=incident, source="discord", raw_payload={"description": description})
        db.add(alert)
        await db.commit()
        await db.refresh(incident)

        normalizer = AlertNormalizer()
        normalized = normalizer.from_raw(
            source="discord",
            raw={"description": description, "service": service_name, "title": description},
        )

        try:
            engine = InvestigationEngine(db)
            rca_data = await engine.investigate(incident.id, normalized)

            # If this came from a slash command, patch the deferred response first
            if application_id and interaction_token:
                await _patch_interaction_response(application_id, interaction_token, {
                    "content": f"✅ Investigation complete for **{service_name}** — see below.",
                })

            await adapter.post_rca(channel_id, thread_id, rca_data, description)

        except Exception as exc:
            logger.exception("Discord investigation failed")
            if application_id and interaction_token:
                await _patch_interaction_response(application_id, interaction_token, {
                    "content": f"❌ Investigation failed: {exc!s:.200}"
                })
            await adapter.post_error(channel_id, thread_id, str(exc))


def _detect_severity(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["critical", "down", "outage", "p0", "production"]):
        return "critical"
    if any(w in text_lower for w in ["high", "degraded", "p1", "error", "latency"]):
        return "high"
    return "medium"


# ---------------------------------------------------------------------------
# Main interactions endpoint
# ---------------------------------------------------------------------------

@router.post("/interactions")
async def discord_interactions(request: Request, background_tasks: BackgroundTasks):
    body = await _verify_discord_request(request)
    data = json.loads(body)
    interaction_type = data.get("type")

    # ── Type 1: PING (Discord URL verification) ────────────────────────────
    if interaction_type == 1:
        return JSONResponse(content={"type": 1})

    # ── Type 2: APPLICATION_COMMAND ────────────────────────────────────────
    if interaction_type == 2:
        command_name = data.get("data", {}).get("name", "")
        channel_id = data.get("channel_id", "")
        application_id = data.get("application_id") or settings.discord_application_id
        token = data.get("token", "")
        options = {
            opt["name"]: opt.get("value", "")
            for opt in data.get("data", {}).get("options", [])
        }

        if command_name == "agent":
            action = options.get("action", "help")

            # ── /agent investigate <description> ───────────────────────────
            if action == "investigate":
                description = options.get("description", "").strip()
                if not description:
                    return JSONResponse(content={
                        "type": 4,
                        "data": {"content": "❌ Provide a description: `/agent investigate description:payment service is returning 500s`"}
                    })

                background_tasks.add_task(
                    _run_investigation_discord,
                    channel_id, description, application_id, token,
                )

                return JSONResponse(content={
                    "type": 5,  # DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
                    "data": {"flags": 0},
                })

            # ── /agent status ──────────────────────────────────────────────
            elif action == "status":
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
                    return JSONResponse(content={"type": 4, "data": {"content": "✅ No active investigations."}})

                lines = [
                    f"• **{i.title[:60]}** — `{i.service_name}` [{i.severity.upper()}]"
                    for i in active
                ]
                return JSONResponse(content={
                    "type": 4,
                    "data": {"content": "🔥 **Active Investigations:**\n" + "\n".join(lines)},
                })

            # ── /agent help ────────────────────────────────────────────────
            else:
                return JSONResponse(content={
                    "type": 4,
                    "data": {
                        "content": (
                            "**sre.ai Agent Commands**\n"
                            "• `/agent investigate description:<what's wrong>` — trigger AI investigation\n"
                            "• `/agent status` — list active investigations\n"
                            "• `/agent help` — show this message\n\n"
                            "You can also just mention keywords like *alert*, *outage*, *latency spike* "
                            "in any monitored channel and the agent will auto-investigate."
                        )
                    },
                })

    return JSONResponse(content={"type": 1})


# ---------------------------------------------------------------------------
# Register slash commands helper
# ---------------------------------------------------------------------------

@router.post("/register-commands")
async def register_discord_commands():
    """Call once to register /agent slash command with Discord."""
    if not settings.discord_application_id or not settings.discord_bot_token:
        raise HTTPException(400, "DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN required in env")

    url = f"{DISCORD_API}/applications/{settings.discord_application_id}/commands"
    commands = [
        {
            "name": "agent",
            "description": "sre.ai — investigate incidents, check status",
            "options": [
                {
                    "name": "action",
                    "description": "What to do",
                    "type": 3,
                    "required": True,
                    "choices": [
                        {"name": "🔍 Investigate an issue", "value": "investigate"},
                        {"name": "📊 Show active incidents", "value": "status"},
                        {"name": "❓ Help", "value": "help"},
                    ],
                },
                {
                    "name": "description",
                    "description": "Describe the issue (required for investigate)",
                    "type": 3,
                    "required": False,
                },
            ],
        }
    ]

    async with httpx.AsyncClient() as client:
        resp = await client.put(
            url,
            json=commands,
            headers={"Authorization": f"Bot {settings.discord_bot_token}"},
            timeout=10,
        )
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code, f"Discord API error: {resp.text}")
        return {"registered": len(commands), "commands": [c["name"] for c in commands]}
