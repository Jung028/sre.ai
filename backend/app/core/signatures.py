import hashlib
import hmac

from app.core.exceptions import SignatureVerificationError


def _constant_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def verify_pagerduty_signature(secret: str, header: str, raw_body: str) -> None:
    """PagerDuty v3 webhooks: X-PagerDuty-Signature: v1=<hex>"""
    if not secret:
        return  # skip verification if not configured
    if not header:
        raise SignatureVerificationError("Missing X-PagerDuty-Signature header", "pagerduty")

    signatures = {
        part.split("=", 1)[1]
        for part in header.split(",")
        if part.startswith("v1=")
    }
    if not signatures:
        raise SignatureVerificationError("No v1 signatures found in header", "pagerduty")

    expected = hmac.new(
        secret.encode(), raw_body.encode(), hashlib.sha256
    ).hexdigest()

    if not any(_constant_compare(expected, sig) for sig in signatures):
        raise SignatureVerificationError("Signature mismatch", "pagerduty")


def verify_datadog_signature(secret: str, header: str, raw_body: str) -> None:
    """Datadog webhooks: X-Datadog-Signature: <hex>"""
    if not secret:
        return
    if not header:
        raise SignatureVerificationError("Missing X-Datadog-Signature header", "datadog")

    expected = hmac.new(
        secret.encode(), raw_body.encode(), hashlib.sha256
    ).hexdigest()

    if not _constant_compare(expected, header):
        raise SignatureVerificationError("Signature mismatch", "datadog")


def verify_grafana_signature(secret: str, header: str, raw_body: str) -> None:
    """Grafana webhooks: X-Grafana-Signature: <hex> (SHA256 of secret + body)"""
    if not secret:
        return
    if not header:
        raise SignatureVerificationError("Missing X-Grafana-Signature header", "grafana")

    expected = hashlib.sha256((secret + raw_body).encode()).hexdigest()

    if not _constant_compare(expected, header):
        raise SignatureVerificationError("Signature mismatch", "grafana")
