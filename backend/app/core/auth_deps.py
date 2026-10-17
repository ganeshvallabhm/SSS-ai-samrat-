"""
Auth dependencies for FastAPI route protection.

get_current_user  → returns authenticated User or raises 401.
require_role(...) → factory returning a dependency that raises 403 for wrong role.
"""
from __future__ import annotations

from typing import Callable

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.auth import User, UserStatus
from app.services.tokens import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Extract and validate the Bearer JWT from the Authorization header.
    Returns the User ORM object.
    Raises 401 for missing/invalid/expired token.
    Raises 401 for blocked/inactive users.
    """
    raw_token = None
    if credentials is not None:
        raw_token = credentials.credentials
    elif "token" in request.query_params:
        raw_token = request.query_params["token"]

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Missing authentication token"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(raw_token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Invalid or expired token"},
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Invalid token claims"},
        )

    result = await db.execute(sa.select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "User not found"},
        )

    if user.status != UserStatus.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "unauthorized", "message": "Account is not active"},
        )

    return user


def require_role(*roles: str) -> Callable:
    """
    Dependency factory — raises 403 if the authenticated user's role is not in roles.

    Usage:
        @router.get("/admin/kpis", dependencies=[Depends(require_role("admin"))])
    """
    async def _check(user: User = Depends(get_current_user)) -> User:
        role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
        if role_val not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "forbidden", "message": "Insufficient permissions"},
            )
        return user

    return _check
