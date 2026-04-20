#!/usr/bin/env python3
"""
End-to-end test: PagerDuty webhook → investigation → SSE stream

Usage:
    python scripts/test_e2e.py [--url http://localhost:8000] [--api-key YOUR_KEY]
"""
import argparse
import hashlib
import hmac
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:8000"
API_KEY = ""

FAKE_PAGERDUTY_PAYLOAD = {
    "messages": [
        {
            "event": "incident.triggered",
            "id": f"test-{int(time.time())}",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "data": {
                "id": f"P{int(time.time())}",
                "title": "[TEST] High error rate on payment-service",
                "status": "triggered",
                "urgency": "high",
                "service": {
                    "id": "PSVC001",
                    "name": "payment-service",
                },
                "body": {
                    "details": "Error rate exceeded 10% threshold. p99 latency at 4.2s.",
                },
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        }
    ]
}


def make_headers(body: bytes, secret: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["X-API-Key"] = API_KEY
    if secret:
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-PagerDuty-Signature"] = f"v1={sig}"
    return headers


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        headers={"X-API-Key": API_KEY} if API_KEY else {},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def send_webhook(payload: dict) -> bool:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/webhooks/pagerduty",
        data=body,
        headers=make_headers(body),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
            print(f"✅ Webhook accepted: incident_id={result.get('incident_id')}")
            return result.get("incident_id")
    except urllib.error.HTTPError as e:
        print(f"❌ Webhook failed: {e.code} {e.read().decode()}")
        return None


def poll_for_incident(incident_id: str, timeout: int = 30) -> bool:
    print(f"⏳ Polling for incident {incident_id}...")
    start = time.time()
    while time.time() - start < timeout:
        try:
            incident = api_get(f"/api/incidents/{incident_id}")
            print(f"✅ Incident found: status={incident['status']}")
            return True
        except Exception:
            time.sleep(1)
    print("❌ Timed out waiting for incident")
    return False


def stream_events(incident_id: str, timeout: int = 180):
    print(f"\n📡 Streaming investigation events for {incident_id}...\n")
    url = f"{BASE_URL}/api/incidents/{incident_id}/stream"
    req = urllib.request.Request(url, headers={"X-API-Key": API_KEY} if API_KEY else {})
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for raw_line in r:
                if time.time() - start > timeout:
                    print("⏰ Timed out")
                    break
                line = raw_line.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                data = json.loads(line[5:].strip())
                event_type = data.get("type", "")
                payload = data.get("data", {})

                if event_type == "thought":
                    print(f"💭 {payload.get('text', '')[:120]}")
                elif event_type == "tool_start":
                    print(f"🔧 Tool: {payload.get('tool_name')}({json.dumps(payload.get('input', {}))[:80]})")
                elif event_type == "tool_end":
                    print(f"   ↳ Result preview: {str(payload.get('result', ''))[:100]}")
                elif event_type == "result":
                    print(f"\n✅ Investigation complete!")
                    rca = payload.get("rca", {})
                    print(f"   Root cause: {rca.get('root_cause', 'N/A')}")
                    print(f"   Confidence: {rca.get('confidence', 'N/A')}")
                    return True
                elif event_type == "error":
                    print(f"\n❌ Investigation error: {payload.get('message')}")
                    return False
    except Exception as e:
        print(f"❌ Stream error: {e}")
        return False


def main():
    global BASE_URL, API_KEY

    parser = argparse.ArgumentParser(description="sre.ai end-to-end test")
    parser.add_argument("--url", default="http://localhost:8000", help="Backend URL")
    parser.add_argument("--api-key", default="", help="API key (if auth enabled)")
    args = parser.parse_args()

    BASE_URL = args.url.rstrip("/")
    API_KEY = args.api_key

    print("🚀 sre.ai End-to-End Test\n")

    # 1. Health check
    try:
        health = api_get("/health")
        print(f"✅ Backend healthy: {health}")
    except Exception as e:
        print(f"❌ Backend not reachable: {e}")
        sys.exit(1)

    # 2. Send webhook
    incident_id = send_webhook(FAKE_PAGERDUTY_PAYLOAD)
    if not incident_id:
        sys.exit(1)

    # 3. Poll until incident visible
    if not poll_for_incident(incident_id):
        sys.exit(1)

    # 4. Stream events
    stream_events(incident_id)


if __name__ == "__main__":
    main()
