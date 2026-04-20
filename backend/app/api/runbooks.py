from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.runbook import Runbook

router = APIRouter(prefix="/runbooks", tags=["runbooks"])


# --- Schemas ---

class RunbookOut(BaseModel):
    id: str
    service_name: str
    source: str
    content: str
    generated_from_rca_id: str | None
    updated_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class RunbookListItem(BaseModel):
    id: str
    service_name: str
    source: str
    preview: str
    updated_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class RunbookUpsert(BaseModel):
    content: str


# --- Routes ---

@router.get("", response_model=list[RunbookListItem])
async def list_runbooks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Runbook).order_by(Runbook.updated_at.desc()))
    runbooks = result.scalars().all()
    return [
        RunbookListItem(
            id=rb.id,
            service_name=rb.service_name,
            source=rb.source,
            preview=rb.content[:200],
            updated_at=rb.updated_at,
            created_at=rb.created_at,
        )
        for rb in runbooks
    ]


@router.get("/{service_name}", response_model=RunbookOut)
async def get_runbook(service_name: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Runbook).where(Runbook.service_name == service_name)
    )
    runbook = result.scalar_one_or_none()
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return runbook


@router.put("/{service_name}", response_model=RunbookOut)
async def upsert_runbook(
    service_name: str, body: RunbookUpsert, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Runbook).where(Runbook.service_name == service_name)
    )
    runbook = result.scalar_one_or_none()
    if runbook:
        runbook.content = body.content
        runbook.source = "manual"
    else:
        runbook = Runbook(
            service_name=service_name,
            content=body.content,
            source="manual",
        )
        db.add(runbook)
    await db.commit()
    await db.refresh(runbook)
    return runbook
