#!/usr/bin/env python3
"""
Seed a mock incident via the API for UI testing.
Usage: python scripts/seed_mock_incident.py [--url http://localhost:8000]
"""
import json, time, urllib.request, argparse
from datetime import datetime, timezone

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--api-key", default="")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    payload = {
        "messages": [{
            "event": "incident.triggered",
            "id": f"seed-{int(time.time())}",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "data": {
                "id": f"PSEED{int(time.time())}",
                "title": "[SEED] Mock high latency on api-gateway",
                "status": "triggered",
                "urgency": "high",
                "service": {"id": "GW001", "name": "api-gateway"},
                "body": {"details": "p99 latency at 8s, above 2s SLA threshold."},
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        }]
    }

    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if args.api_key:
        headers["X-API-Key"] = args.api_key

    req = urllib.request.Request(f"{base}/api/webhooks/pagerduty", data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        result = json.loads(r.read())
        print(f"✅ Seeded incident: {result}")

if __name__ == "__main__":
    main()
