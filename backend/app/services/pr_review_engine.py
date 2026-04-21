"""
PR Review Engine — AI-powered GitHub pull request reviewer.

When triggered by a GitHub webhook (pull_request opened/synchronized),
this engine:
  1. Fetches the PR diff from GitHub
  2. Sends the diff to Groq for structured analysis
  3. Posts a review back to the PR with actionable findings

The review catches:
  - Security vulnerabilities
  - Performance regressions (N+1 queries, unbounded loops)
  - Reliability risks (missing error handling, no timeouts)
  - SRE concerns (missing metrics/tracing, risky migrations)
  - Patterns that correlate with future production incidents
"""
import json
import logging
import re

from app.config import settings

logger = logging.getLogger(__name__)

SEVERITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}

REVIEW_SYSTEM_PROMPT = """You are an expert SRE and principal engineer.
You review pull requests specifically for production-safety risks.
You have seen hundreds of outages caused by code patterns that look fine in review but fail in production.
Be concrete, actionable, and prioritize ruthlessly — not every PR has issues."""

REVIEW_PROMPT_TEMPLATE = """## Pull Request to Review

**Title**: {title}
**Author**: @{author}
**Branch**: `{head_branch}` → `{base_branch}`
**Description**: {body}

## Changed Files & Diff
{diff}

## Review Instructions

Analyze this PR for production risks. Focus on:

1. **Security** — injection flaws, broken auth, exposed credentials, SSRF, path traversal
2. **Performance** — N+1 queries, missing DB indexes, unbounded result sets, large in-memory ops
3. **Reliability** — missing error handling, no retries on transient failures, race conditions, missing timeouts, unhandled edge cases
4. **Observability** — new code paths without logging/metrics/tracing, silent failures
5. **SRE / Operational** — risky schema migrations, missing feature flags for risky changes, no rollback plan, config that could cause startup failures

Output ONLY valid JSON (no markdown wrapper):
{{
  "verdict": "approve | request_changes | comment",
  "summary": "One sentence overall assessment",
  "overall_risk": "high | medium | low | none",
  "issues": [
    {{
      "severity": "critical | high | medium | low",
      "type": "security | performance | reliability | observability | operational",
      "file": "path/to/file.py",
      "line": null,
      "description": "What the problem is and why it matters in production",
      "suggestion": "Concrete fix with code example if helpful"
    }}
  ],
  "praise": ["Specific good things about this PR — skip if nothing notable"],
  "learning_notes": ["Patterns observed that should be added to the team runbook"]
}}
"""


class PRReviewEngine:

    def __init__(self):
        from groq import AsyncGroq
        self.client = AsyncGroq(api_key=settings.groq_api_key)

    async def review_and_post(self, pr_event: dict) -> None:
        """Entry point — called from GitHub webhook handler."""
        pr = pr_event.get("pull_request", {})
        repo_full_name: str = pr_event.get("repository", {}).get("full_name", "")
        pr_number: int = pr.get("number", 0)

        if not repo_full_name or not pr_number:
            logger.warning("PR review skipped — missing repo or PR number")
            return

        logger.info("Starting AI review of %s#%d", repo_full_name, pr_number)

        diff = await self._fetch_pr_diff(repo_full_name, pr_number)
        if not diff:
            logger.warning("No diff found for %s#%d", repo_full_name, pr_number)
            return

        review = await self._ai_review(pr, diff)
        await self._post_github_review(repo_full_name, pr_number, review)

        logger.info(
            "PR review posted to %s#%d — verdict=%s risk=%s issues=%d",
            repo_full_name, pr_number,
            review.get("verdict"), review.get("overall_risk"), len(review.get("issues", [])),
        )

    # ------------------------------------------------------------------
    # Diff fetching
    # ------------------------------------------------------------------

    async def _fetch_pr_diff(self, repo_full_name: str, pr_number: int) -> str:
        import asyncio
        return await asyncio.get_event_loop().run_in_executor(
            None, self._fetch_pr_diff_sync, repo_full_name, pr_number
        )

    def _fetch_pr_diff_sync(self, repo_full_name: str, pr_number: int) -> str:
        from github import Github
        gh = Github(settings.github_token)
        repo = gh.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)

        sections: list[str] = []
        for f in list(pr.get_files())[:40]:  # cap — avoid token overflow
            header = f"### {f.filename}  (+{f.additions} / -{f.deletions})"
            if f.patch:
                sections.append(f"{header}\n```diff\n{f.patch[:4000]}\n```")
            else:
                sections.append(f"{header}\n_(binary or too large)_")

        return "\n\n".join(sections)

    # ------------------------------------------------------------------
    # AI review
    # ------------------------------------------------------------------

    async def _ai_review(self, pr: dict, diff: str) -> dict:
        prompt = REVIEW_PROMPT_TEMPLATE.format(
            title=pr.get("title", "")[:200],
            author=pr.get("user", {}).get("login", "unknown"),
            head_branch=pr.get("head", {}).get("ref", "?"),
            base_branch=pr.get("base", {}).get("ref", "?"),
            body=(pr.get("body") or "")[:800],
            diff=diff[:10_000],  # ~3-4k tokens for diff
        )

        try:
            response = await self.client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=2500,
            )
            raw = response.choices[0].message.content or "{}"
        except Exception as exc:
            logger.error("Groq PR review failed: %s", exc)
            return self._fallback_review(str(exc))

        # Strip possible markdown code fences
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # Try to extract JSON object
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass
            logger.warning("Could not parse AI review JSON; using fallback")
            return self._fallback_review(raw[:300])

    @staticmethod
    def _fallback_review(reason: str) -> dict:
        return {
            "verdict": "comment",
            "summary": f"AI review could not complete: {reason}",
            "overall_risk": "unknown",
            "issues": [],
            "praise": [],
            "learning_notes": [],
        }

    # ------------------------------------------------------------------
    # Post review to GitHub
    # ------------------------------------------------------------------

    async def _post_github_review(self, repo_full_name: str, pr_number: int, review: dict) -> None:
        import asyncio
        return await asyncio.get_event_loop().run_in_executor(
            None, self._post_github_review_sync, repo_full_name, pr_number, review
        )

    def _post_github_review_sync(self, repo_full_name: str, pr_number: int, review: dict) -> None:
        from github import Github
        gh = Github(settings.github_token)
        repo = gh.get_repo(repo_full_name)
        pr = repo.get_pull(pr_number)

        body = self._render_review_body(review)
        verdict_map = {
            "approve": "APPROVE",
            "request_changes": "REQUEST_CHANGES",
            "comment": "COMMENT",
        }
        event = verdict_map.get(review.get("verdict", "comment"), "COMMENT")
        pr.create_review(body=body, event=event)

    @staticmethod
    def _render_review_body(review: dict) -> str:
        risk = review.get("overall_risk", "unknown").upper()
        risk_emoji = {"HIGH": "🔴", "MEDIUM": "🟠", "LOW": "🟢", "NONE": "✅"}.get(risk, "⚪")

        lines: list[str] = [
            "## 🤖 sre.ai Automated PR Review",
            "",
            f"**Overall Risk**: {risk_emoji} {risk}",
            "",
            "### Summary",
            review.get("summary", "_No summary_"),
            "",
        ]

        issues: list[dict] = review.get("issues", [])
        if issues:
            lines.append("### Issues Found")
            lines.append("")
            for issue in issues:
                sev = issue.get("severity", "medium")
                emoji = SEVERITY_EMOJI.get(sev, "⚪")
                typ = issue.get("type", "").title()
                file_ref = f"`{issue['file']}`" if issue.get("file") else ""
                lines.append(f"{emoji} **[{sev.upper()}] {typ}** {file_ref}")
                lines.append(f"> {issue.get('description', '')}")
                if issue.get("suggestion"):
                    lines.append(f">\n> 💡 **Fix**: {issue['suggestion']}")
                lines.append("")

        praise: list[str] = review.get("praise", [])
        if praise:
            lines.append("### ✅ Good Practices")
            for p in praise:
                lines.append(f"- {p}")
            lines.append("")

        notes: list[str] = review.get("learning_notes", [])
        if notes:
            lines.append("### 📚 Runbook Notes")
            for n in notes:
                lines.append(f"- {n}")
            lines.append("")

        lines += [
            "---",
            "_Review generated by [sre.ai](https://github.com/Jung028/sre.ai) · AI-assisted SRE platform_",
        ]
        return "\n".join(lines)
