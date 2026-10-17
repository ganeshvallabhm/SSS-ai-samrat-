from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class ReviewDecision(str, Enum):
    approve = "approve"
    reject = "reject"


class ReviewActionRequest(BaseModel):
    decision: ReviewDecision
    reason: Optional[str] = Field(None, description="Mandatory when decision is reject")
    internalNotes: Optional[str] = Field(None, description="Optional reviewer internal notes")
    points: Optional[int] = Field(None, ge=0, description="Optional points override on approval")
