from __future__ import annotations

from typing import List, Literal, Optional
from pydantic import BaseModel, Field

from app.schemas.submissions import PaginationMeta


class WalletSummary(BaseModel):
    balance: int = Field(..., description="Current spendable points balance")
    monthlyPoints: int = Field(..., description="Points earned in current calendar month (IST)")
    monthlyCap: int = Field(default=500, description="Monthly earning cap")
    monthlyProgressPercent: float = Field(..., description="Percentage of monthly cap reached")


class PointsTransaction(BaseModel):
    id: str
    title: str
    points: int
    date: str
    type: Literal["earned", "redeemed"]


class PaginatedTransactions(BaseModel):
    items: List[PointsTransaction]
    meta: PaginationMeta
