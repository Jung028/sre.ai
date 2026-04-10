from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

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


settings = Settings()
