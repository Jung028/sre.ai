import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.trace import Span, Trace
from app.schemas.trace import TraceIn, TraceOut, TraceSummary

router = APIRouter(prefix="/traces", tags=["traces"])


@router.post("", response_model=TraceOut, status_code=201)
async def create_trace(body: TraceIn, db: AsyncSession = Depends(get_db)):
    """Create a trace with all its spans in one request."""
    trace = Trace(
        id=str(uuid.uuid4()),
        trace_id=body.trace_id,
        incident_id=body.incident_id,
        service=body.service,
        duration_ms=body.duration_ms,
        status=body.status,
        started_at=body.started_at,
    )
    db.add(trace)
    await db.flush()  # populate trace.id before inserting spans

    for span_in in body.spans:
        span = Span(
            id=str(uuid.uuid4()),
            trace_id=trace.id,
            span_id=span_in.span_id,
            parent_span_id=span_in.parent_span_id,
            service=span_in.service,
            operation=span_in.operation,
            status=span_in.status,
            start_offset_ms=span_in.start_offset_ms,
            duration_ms=span_in.duration_ms,
            tags=span_in.tags,
            logs=span_in.logs,
        )
        db.add(span)

    await db.commit()

    # Re-fetch with spans loaded
    result = await db.execute(
        select(Trace).options(selectinload(Trace.spans)).where(Trace.id == trace.id)
    )
    return result.scalar_one()


@router.get("", response_model=list[TraceSummary])
async def list_traces(
    incident_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """List recent traces with span counts. Optionally filter by incident_id."""
    span_count_subq = (
        select(Span.trace_id, func.count(Span.id).label("span_count"))
        .group_by(Span.trace_id)
        .subquery()
    )

    q = (
        select(
            Trace.id,
            Trace.trace_id,
            Trace.incident_id,
            Trace.service,
            Trace.duration_ms,
            Trace.status,
            Trace.started_at,
            func.coalesce(span_count_subq.c.span_count, 0).label("span_count"),
        )
        .outerjoin(span_count_subq, Trace.id == span_count_subq.c.trace_id)
        .order_by(Trace.started_at.desc())
        .limit(limit)
    )

    if incident_id is not None:
        q = q.where(Trace.incident_id == incident_id)

    result = await db.execute(q)
    rows = result.mappings().all()
    return [TraceSummary(**row) for row in rows]


@router.get("/{trace_id}", response_model=TraceOut)
async def get_trace(trace_id: str, db: AsyncSession = Depends(get_db)):
    """Get a full trace with all spans by external trace_id string."""
    result = await db.execute(
        select(Trace)
        .options(selectinload(Trace.spans))
        .where(Trace.trace_id == trace_id)
    )
    trace = result.scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace
