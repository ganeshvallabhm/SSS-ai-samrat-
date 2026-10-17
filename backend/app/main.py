from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.health import router as health_router
from app.routers.auth import router as auth_router
from app.routers.tasks import router as tasks_router
from app.routers.submissions import router as submissions_router
from app.routers.reviewer import router as reviewer_router
from app.routers.wallet import router as wallet_router


def _startup_guard() -> None:
    """
    Refuse to start in ENVIRONMENT=production with MockSmsProvider.
    The get_sms_provider factory raises RuntimeError for production + mock.
    """
    if settings.ENVIRONMENT == "production":
        from app.services.sms import get_sms_provider
        get_sms_provider(settings.ENVIRONMENT)  # raises if mock is the only option


_startup_guard()

app = FastAPI(
    title="SSS Civic Tech Backend API",
    description="Backend API for SSS Civic Tech Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(submissions_router, prefix="/api/v1")
app.include_router(reviewer_router, prefix="/api/v1")
app.include_router(wallet_router, prefix="/api/v1")

# Also mount at root so endpoints are accessible with or without /api/v1 prefix
app.include_router(tasks_router)
app.include_router(submissions_router)
app.include_router(reviewer_router)
app.include_router(wallet_router)


@app.get("/")
async def root():
    return {"message": "SSS Civic Tech API is running. Check /health for status."}
