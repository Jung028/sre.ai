"""Celery tasks for async investigation execution."""
import asyncio
import json
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def investigate_alert_task(self, incident_id: str):
    """
    Run the AI investigation engine for an incident.
    SSE events are published to Redis pub/sub channel: investigation:{incident_id}
    """
    asyncio.run(_run_investigation(incident_id))


async def _run_investigation(incident_id: str):
    import redis.asyncio as aioredis
    from sqlalchemy import select

    from app.config import settings
    from app.core.events import StreamEvent
    from app.database import AsyncSessionLocal
    from app.models.incident import Incident
    from app.services.alert_normalizer import NormalizedAlert
    from app.services.investigation_engine import InvestigationEngine

    redis_client = aioredis.from_url(settings.redis_url)
    channel = f"investigation:{incident_id}"
    event_queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

    async def _publish_events():
        while True:
            event = await event_queue.get()
            if event is None:
                break
            try:
                await redis_client.publish(channel, event.to_json())
            except Exception as e:
                logger.error(f"Failed to publish SSE event: {e}")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Incident).where(Incident.id == incident_id))
        incident = result.scalar_one_or_none()
        if not incident:
            logger.error(f"Incident {incident_id} not found")
            return

        normalized_data = incident.raw_payload.get("normalized", {})
        alert = NormalizedAlert(
            source=normalized_data.get("source", ""),
            external_id=normalized_data.get("external_id", ""),
            title=normalized_data.get("title", ""),
            severity=normalized_data.get("severity", "high"),
            service_name=normalized_data.get("service_name"),
            description=normalized_data.get("description", ""),
            labels=normalized_data.get("labels", {}),
            fired_at=_parse_dt(normalized_data.get("fired_at")),
            runbook_url=normalized_data.get("runbook_url"),
            raw=incident.raw_payload.get("original", {}),
        )

        publisher_task = asyncio.create_task(_publish_events())
        engine = InvestigationEngine(db)

        try:
            rca = await engine.investigate(incident, alert, event_queue)
            logger.info(f"Investigation complete for {incident_id}: {rca.root_cause}")

            # Post to Slack
            await _post_rca_to_slack(incident, rca)

            # Create GitHub PR if needed
            if rca.needs_pr and rca.pr_description:
                await _create_github_pr(incident, rca, db)

        except Exception as e:
            logger.exception(f"Investigation failed for {incident_id}: {e}")
        finally:
            await event_queue.put(None)
            await publisher_task
            await redis_client.aclose()


async def _post_rca_to_slack(incident, rca):
    from app.config import settings

    if not settings.slack_bot_token:
        return
    from app.services.slack_service import SlackService

    slack = SlackService()
    try:
        await slack.post_rca(incident, rca)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Slack post failed: {e}")


async def _create_github_pr(incident, rca, db):
    from app.config import settings

    if not settings.github_token:
        return
    from app.services.github_service import GitHubService
    from sqlalchemy import update

    from app.models.rca import RCA

    github = GitHubService()
    try:
        pr_url = await github.create_fix_pr(incident, rca)
        await db.execute(
            update(RCA).where(RCA.id == rca.id).values(github_pr_url=pr_url)
        )
        await db.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"GitHub PR creation failed: {e}")


def _parse_dt(value: str | None):
    from datetime import datetime, timezone

    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)
