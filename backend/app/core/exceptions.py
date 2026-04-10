class SignatureVerificationError(Exception):
    def __init__(self, reason: str, service: str):
        self.reason = reason
        self.service = service
        super().__init__(f"[{service}] Signature verification failed: {reason}")


class InvestigationError(Exception):
    pass


class IntegrationError(Exception):
    def __init__(self, integration: str, message: str):
        self.integration = integration
        super().__init__(f"[{integration}] {message}")
