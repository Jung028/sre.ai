"""SSE streaming endpoint for live investigation events."""
import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.incident import Incident

router = APIRouter(tags=["investigations"])


@router.get("/incidents/{incident_id}/stream")
async def stream_investigation(incident_id: str, db: AsyncSession = Depends(get_db)):
    """
    Server-Sent Events stream for a live investigation.
    Subscribes to Redis pub/sub channel for the incident.
    Closes automatically when a 'result' or 'error' event is received.
    """
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Incident not found")

    async def event_generator():
        redis_client = aioredis.from_url(settings.redis_url)
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(f"investigation:{incident_id}")

        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()

                yield f"data: {data}\n\n"

                # Auto-close on terminal events
                try:
                    parsed = json.loads(data)
                    if parsed.get("type") in ("result", "error"):
                        break
                except json.JSONDecodeError:
                    pass
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(f"investigation:{incident_id}")
            await redis_client.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
