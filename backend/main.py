from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.incidents import router as incidents_router
from app.api.investigations import router as investigations_router
from app.api.runbooks import router as runbooks_router
from app.api.topology import router as topology_router
from app.api.traces import router as traces_router
from app.api.webhooks import router as webhooks_router
from app.core.auth import require_api_key
from app.database import engine
from app.models import *  # noqa: F401, F403 — ensures models are registered


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="sre.ai",
    description="AI-powered Site Reliability Engineering platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check — no auth
app.include_router(health_router)

# Webhooks — HMAC auth handled internally, no API key required
app.include_router(webhooks_router, prefix="/api")

# Protected routes — require API key when settings.api_key is set
app.include_router(
    incidents_router, prefix="/api", dependencies=[Depends(require_api_key)]
)
app.include_router(
    investigations_router, prefix="/api", dependencies=[Depends(require_api_key)]
)
app.include_router(
    topology_router, prefix="/api", dependencies=[Depends(require_api_key)]
)
app.include_router(
    traces_router, prefix="/api", dependencies=[Depends(require_api_key)]
)
app.include_router(
    runbooks_router, prefix="/api", dependencies=[Depends(require_api_key)]
)
