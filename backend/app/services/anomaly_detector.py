"""
Statistical Anomaly Detector
Z-score based anomaly detection with rolling baseline.
Detects sudden spikes/drops that account for normal variance.
For production: swap _compute_baseline with Prophet for seasonality.
"""
import math
from dataclasses import dataclass
from typing import Optional

from app.services.metrics_fetcher import MetricsFetcher


@dataclass
class Anomaly:
    metric: str
    service: str
    timestamp: str
    value: float
    baseline_mean: float
    baseline_stddev: float
    z_score: float
    severity: str  # "warning" | "critical"
    description: str


class AnomalyDetector:
    """
    Rolling z-score anomaly detection.

    Steps:
    1. Fetch metric history (longer baseline window)
    2. Compute rolling mean + stddev for baseline
    3. Flag points > 2σ (warning) or > 3σ (critical)
    """

    Z_WARNING = 2.0
    Z_CRITICAL = 3.0

    def __init__(self, metrics_fetcher: MetricsFetcher):
        self.fetcher = metrics_fetcher

    async def detect(
        self,
        metric: str,
        service: str,
        window_hours: int = 2,
        baseline_hours: int = 24,
    ) -> dict:
        """
        Detect anomalies in the last `window_hours` vs baseline of `baseline_hours`.
        """
        # Fetch baseline (longer window for stable statistics)
        baseline_data = await self.fetcher.fetch(
            metric=metric,
            service=service,
            start_time=f"now-{baseline_hours}h",
            end_time=f"now-{window_hours}h",
            aggregation="avg",
        )

        # Fetch recent window (what we're checking)
        recent_data = await self.fetcher.fetch(
            metric=metric,
            service=service,
            start_time=f"now-{window_hours}h",
            end_time="now",
            aggregation="avg",
        )

        baseline_points = self._extract_values(baseline_data)
        recent_points = self._extract_values(recent_data)

        if len(baseline_points) < 3:
            return {
                "metric": metric,
                "service": service,
                "anomalies": [],
                "baseline_points": len(baseline_points),
                "note": "Insufficient baseline data for anomaly detection",
            }

        mean, stddev = self._compute_baseline(baseline_points)

        anomalies = []
        for point in recent_points:
            value = point.get("value", 0) if isinstance(point, dict) else float(point[1]) if isinstance(point, (list, tuple)) and len(point) > 1 else 0
            if stddev == 0:
                z = 0.0
            else:
                z = abs(value - mean) / stddev

            if z >= self.Z_WARNING:
                severity = "critical" if z >= self.Z_CRITICAL else "warning"
                ts = point.get("timestamp", "") if isinstance(point, dict) else str(point[0]) if isinstance(point, (list, tuple)) else ""
                anomalies.append(Anomaly(
                    metric=metric,
                    service=service,
                    timestamp=ts,
                    value=value,
                    baseline_mean=round(mean, 3),
                    baseline_stddev=round(stddev, 3),
                    z_score=round(z, 2),
                    severity=severity,
                    description=self._describe(metric, value, mean, z, severity),
                ))

        return {
            "metric": metric,
            "service": service,
            "baseline_mean": round(mean, 3),
            "baseline_stddev": round(stddev, 3),
            "baseline_window_hours": baseline_hours,
            "detection_window_hours": window_hours,
            "anomaly_count": len(anomalies),
            "anomalies": [
                {
                    "timestamp": a.timestamp,
                    "value": a.value,
                    "z_score": a.z_score,
                    "severity": a.severity,
                    "description": a.description,
                }
                for a in anomalies
            ],
        }

    def _extract_values(self, data) -> list:
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Try common keys for metric data
            for key in ("points", "values", "data"):
                if key in data:
                    return data[key]
        return []

    def _compute_baseline(self, points: list) -> tuple[float, float]:
        values = []
        for p in points:
            if isinstance(p, dict):
                v = p.get("value")
            elif isinstance(p, (list, tuple)) and len(p) > 1:
                v = p[1]
            else:
                v = p
            if v is not None:
                try:
                    values.append(float(v))
                except (TypeError, ValueError):
                    pass
        if not values:
            return 0.0, 0.0
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        return mean, math.sqrt(variance)

    def _describe(self, metric: str, value: float, mean: float, z: float, severity: str) -> str:
        direction = "spike" if value > mean else "drop"
        pct_change = abs(value - mean) / max(mean, 0.001) * 100
        return (
            f"{severity.upper()}: {metric} {direction} of {pct_change:.0f}% "
            f"(value={value:.2f}, baseline={mean:.2f}, z={z:.1f}σ)"
        )
