import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class StreamEvent:
    type: str  # thought | tool_start | tool_end | result | error
    data: dict
    incident_id: str
    timestamp: str = field(default_factory=_now)

    def to_json(self) -> str:
        return json.dumps(asdict(self))


def thought_event(incident_id: str, text: str) -> StreamEvent:
    return StreamEvent(type="thought", data={"text": text}, incident_id=incident_id)


def tool_start_event(incident_id: str, name: str, inputs: dict | None = None) -> StreamEvent:
    return StreamEvent(
        type="tool_start",
        data={"name": name, "inputs": inputs or {}},
        incident_id=incident_id,
    )


def tool_end_event(
    incident_id: str, name: str, success: bool, summary: str | None = None
) -> StreamEvent:
    return StreamEvent(
        type="tool_end",
        data={"name": name, "success": success, "summary": summary},
        incident_id=incident_id,
    )


def result_event(incident_id: str, rca_markdown: str, success: bool) -> StreamEvent:
    return StreamEvent(
        type="result",
        data={"text": rca_markdown, "success": success},
        incident_id=incident_id,
    )


def error_event(incident_id: str, message: str) -> StreamEvent:
    return StreamEvent(type="error", data={"message": message}, incident_id=incident_id)
