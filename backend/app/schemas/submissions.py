from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field

from app.schemas.tasks import PaginationMeta, TaskOut


class SubmissionStatusEnum(str, Enum):
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"


class StatusTimelineEvent(BaseModel):
    status: SubmissionStatusEnum
    timestamp: datetime
    actor: Optional[str] = None
    note: Optional[str] = None


class SubmissionDetail(BaseModel):
    id: str
    taskId: str
    status: SubmissionStatusEnum
    submittedAt: datetime
    reviewedAt: Optional[datetime] = None
    reason: Optional[str] = None
    photoUrl: str
    lat: float
    lng: float
    accuracy: float
    note: Optional[str] = None
    address: Optional[str] = None
    timeline: List[StatusTimelineEvent] = Field(default_factory=list)
    task: Optional[TaskOut] = None


class PaginatedSubmissions(BaseModel):
    items: List[SubmissionDetail]
    meta: PaginationMeta
