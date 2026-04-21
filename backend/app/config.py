from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Groq
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Database
    database_url: str = "postgresql+asyncpg://sreai:localdev@localhost:5432/sreai"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Slack
    slack_bot_token: str = ""
    slack_signing_secret: str = ""
    slack_default_channel: str = "#incidents"

    # GitHub
    github_token: str = ""
    github_repo: str = ""  # owner/repo
    github_webhook_secret: str = ""  # for verifying PR/push webhook payloads

    # Discord
    discord_bot_token: str = ""
    discord_application_id: str = ""
    discord_public_key: str = ""  # Ed25519 public key for request verification

    # PagerDuty
    pagerduty_webhook_secret: str = ""

    # Datadog
    datadog_api_key: str = ""
    datadog_app_key: str = ""
    datadog_site: str = "datadoghq.com"

    # Grafana
    grafana_url: str = ""
    grafana_api_key: str = ""
    grafana_webhook_secret: str = ""

    # App
    debug: bool = False
    max_investigation_turns: int = 20
    api_key: str = ""  # if empty, auth is disabled

    # Topology
    topology_edges: str = "[]"


settings = Settings()
