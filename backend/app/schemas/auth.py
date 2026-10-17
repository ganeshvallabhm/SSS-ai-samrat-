"""
Pydantic schemas for auth endpoints, matching docs/api-contract.yaml exactly.
"""
from __future__ import annotations

import re
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Accepted Indian mobile number pattern (as passed by client)
_INDIAN_MOBILE_RE = re.compile(
    r"^(\+91|91)?[6-9]\d{9}$"
)


class ErrorResponse(BaseModel):
    """Standard error envelope per API contract."""
    error: str
    message: str
    details: Optional[dict] = None


class OtpRequest(BaseModel):
    """POST /auth/otp/request body."""
    phone: str = Field(..., description="Indian mobile number in any common format")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        cleaned = v.strip().replace(" ", "").replace("-", "")
        if not _INDIAN_MOBILE_RE.match(cleaned):
            raise ValueError(
                "Must be a valid 10-digit Indian mobile number "
                "(optionally prefixed with +91 or 91)"
            )
        return cleaned  # normalisation to 10-digit done in service layer


class OtpRequestResponse(BaseModel):
    """POST /auth/otp/request 200 response."""
    message: str
    expiresInSeconds: int


class OtpVerifyRequest(BaseModel):
    """POST /auth/otp/verify body."""
    phone: str
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        cleaned = v.strip().replace(" ", "").replace("-", "")
        if not _INDIAN_MOBILE_RE.match(cleaned):
            raise ValueError("Invalid Indian mobile number")
        return cleaned


class UserProfile(BaseModel):
    """Embedded user object in AuthSessionResponse."""
    id: UUID
    phone: str
    name: str
    role: str
    language: str

    model_config = {"from_attributes": True}


class AuthTokenPair(BaseModel):
    """Access + refresh token pair."""
    accessToken: str
    refreshToken: str
    expiresIn: int  # access token TTL in seconds


class AuthSessionResponse(BaseModel):
    """POST /auth/otp/verify 200 response."""
    user: UserProfile
    accessToken: str
    refreshToken: str
    expiresIn: int


class RefreshRequest(BaseModel):
    """POST /auth/refresh body."""
    refreshToken: str
