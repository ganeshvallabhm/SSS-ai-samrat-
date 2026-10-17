from __future__ import annotations

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class TaskCategory(str, Enum):
    civic = "civic"
    green = "green"
    health = "health"
    governance = "governance"


class PaginationMeta(BaseModel):
    page: int
    limit: int
    totalItems: int
    totalPages: int
    hasNextPage: Optional[bool] = None


class TaskOut(BaseModel):
    id: str
    title: str
    category: TaskCategory
    points: int
    distance: float
    location: str
    description: str
    requirements: List[str] = Field(default_factory=list)
    date: str


class PaginatedTasks(BaseModel):
    items: List[TaskOut]
    meta: PaginationMeta
