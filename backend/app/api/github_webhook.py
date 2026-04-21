"""
GitHub webhook endpoint.

Handles:
  - pull_request opened/synchronize/reopened → AI PR review
  - push to default branch → update code index (future)

Setup:
  In your GitHub repo → Settings → Webhooks → Add webhook:
    Payload URL: https://your-domain.com/api/github/webhook
    Content type: application/json
    Secret: <GITHUB_WEBHOOK_SECRET from .env>
    Events: Pull requests, Pushes
"""
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/github", tags=["github"])


def _verify_github_signature(payload: bytes, sig_header: str) -> bool:
    """Verify HMAC-SHA256 signature from GitHub."""
    if not settings.github_webhook_secret:
        return True  # dev mode — skip

    if not sig_header.startswith("sha256="):
        return False

    expected = "sha256=" + hmac.new(
        settings.github_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, sig_header)


@router.post("/webhook")
async def github_webhook(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256", "")
    event = request.headers.get("X-GitHub-Event", "")

    if not _verify_github_signature(body, sig):
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature")

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # ── Pull Request events ────────────────────────────────────────────────
    if event == "pull_request":
        action = data.get("action", "")
        pr = data.get("pull_request", {})
        pr_title = pr.get("title", "")
        pr_number = pr.get("number")
        repo = data.get("repository", {}).get("full_name", "")

        if action in ("opened", "synchronize", "reopened"):
            logger.info("Queuing AI review for %s#%d (%s)", repo, pr_number, action)
            from app.services.pr_review_engine import PRReviewEngine
            engine = PRReviewEngine()
            background_tasks.add_task(engine.review_and_post, data)
            return {"status": "queued", "event": "pull_request", "action": action, "pr": pr_number}

    # ── Push events ────────────────────────────────────────────────────────
    if event == "push":
        ref = data.get("ref", "")
        # Only care about default branch pushes (main/master)
        repo_default = data.get("repository", {}).get("default_branch", "main")
        if ref == f"refs/heads/{repo_default}":
            commit_count = len(data.get("commits", []))
            logger.info("Push to %s (%d commits) — code index update queued", repo_default, commit_count)
            # Future: trigger code indexer
            return {"status": "noted", "event": "push", "commits": commit_count}

    return {"status": "ignored", "event": event}
