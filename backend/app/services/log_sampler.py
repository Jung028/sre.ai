"""
Smart Log Sampler
Statistics-first approach to log analysis. Avoids context window exhaustion
by summarizing patterns before fetching raw examples.
"""
import asyncio
import json
import re
from collections import Counter
from typing import Optional

from app.services.log_fetcher import LogFetcher


class LogSampler:
    """
    Two-phase log analysis:
    1. Get aggregate statistics (counts, patterns) — cheap, context-efficient
    2. Sample specific representative examples from top patterns
    """

    def __init__(self):
        self.fetcher = LogFetcher()

    async def get_statistics(self, service: str, window_minutes: int = 30) -> dict:
        """
        Phase 1: Get log statistics without raw log content.
        Returns counts by level, top error patterns, volume timeline.
        """
        start = f"now-{window_minutes}m"

        # Fetch a larger sample for statistical analysis
        raw = await self.fetcher.fetch(
            service=service,
            query="",
            start_time=start,
            end_time="now",
            limit=200,
        )

        logs = raw if isinstance(raw, list) else raw.get("logs", [])

        if not logs:
            return {
                "service": service,
                "window_minutes": window_minutes,
                "total_count": 0,
                "by_level": {},
                "top_errors": [],
                "rate_per_minute": 0,
            }

        # Count by level
        by_level = Counter()
        error_messages = []

        for log in logs:
            level = log.get("level", "info").upper()
            by_level[level] += 1
            if level in ("ERROR", "FATAL", "CRITICAL"):
                msg = log.get("message", "")
                if msg:
                    error_messages.append(msg)

        # Extract top error patterns (strip variable parts)
        patterns = self._extract_patterns(error_messages)
        top_errors = [
            {"pattern": p, "count": c, "example": self._find_example(error_messages, p)}
            for p, c in patterns.most_common(5)
        ]

        return {
            "service": service,
            "window_minutes": window_minutes,
            "total_count": len(logs),
            "by_level": dict(by_level),
            "top_errors": top_errors,
            "rate_per_minute": round(len(logs) / max(window_minutes, 1), 1),
            "error_rate_pct": round(
                (by_level.get("ERROR", 0) + by_level.get("FATAL", 0)) / max(len(logs), 1) * 100, 1
            ),
        }

    async def sample_by_pattern(self, service: str, pattern: str, limit: int = 10) -> dict:
        """
        Phase 2: Get representative examples matching a specific error pattern.
        Much more targeted than fetching all raw logs.
        """
        raw = await self.fetcher.fetch(
            service=service,
            query=pattern,
            start_time="now-1h",
            end_time="now",
            limit=limit,
        )

        logs = raw if isinstance(raw, list) else raw.get("logs", [])

        # Deduplicate — return unique messages only
        seen = set()
        unique_samples = []
        for log in logs:
            msg = log.get("message", "")
            key = msg[:100]  # Use first 100 chars as dedup key
            if key not in seen:
                seen.add(key)
                unique_samples.append({
                    "timestamp": log.get("timestamp", ""),
                    "level": log.get("level", ""),
                    "message": msg[:500],  # Truncate to avoid context bloat
                })
            if len(unique_samples) >= limit:
                break

        return {
            "service": service,
            "pattern": pattern,
            "sample_count": len(unique_samples),
            "samples": unique_samples,
        }

    def _extract_patterns(self, messages: list[str]) -> Counter:
        """Normalize error messages to extract patterns (strip timestamps, IDs, etc.)."""
        patterns = Counter()
        for msg in messages:
            # Normalize: strip UUIDs, numbers, IPs, timestamps
            normalized = re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', '<uuid>', msg)
            normalized = re.sub(r'\b\d+\.\d+\.\d+\.\d+\b', '<ip>', normalized)
            normalized = re.sub(r'\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\b', '<ts>', normalized)
            normalized = re.sub(r'\b\d+\b', '<n>', normalized)
            # Take first 120 chars as the pattern key
            pattern_key = normalized[:120].strip()
            if pattern_key:
                patterns[pattern_key] += 1
        return patterns

    def _find_example(self, messages: list[str], pattern: str) -> str:
        """Find an example message matching the pattern."""
        pattern_words = set(re.sub(r'<\w+>', '', pattern).split())
        for msg in messages:
            if any(w in msg for w in pattern_words if len(w) > 4):
                return msg[:300]
        return messages[0][:300] if messages else ""
