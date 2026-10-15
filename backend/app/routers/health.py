from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.config import settings

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Health check endpoint confirming database connection and PostGIS availability."""
    try:
        # Check basic database connectivity
        db_res = await db.execute(text("SELECT 1"))
        db_ok = db_res.scalar() == 1

        # Check PostGIS extension availability and version
        postgis_res = await db.execute(text("SELECT PostGIS_Full_Version()"))
        postgis_version = postgis_res.scalar()

        return {
            "status": "ok",
            "database": "connected",
            "postgis": postgis_version,
            "environment": settings.ENVIRONMENT,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "error",
                "database": "disconnected",
                "error": str(exc),
            },
        )
