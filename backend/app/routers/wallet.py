from __future__ import annotations

import math
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_role
from app.db import get_db
from app.models.auth import User
from app.models.reviews import PointsLedger, LedgerType
from app.schemas.submissions import PaginationMeta
from app.schemas.wallet import PaginatedTransactions, PointsTransaction, WalletSummary

router = APIRouter(prefix="/wallet", tags=["Wallet"])

MONTHLY_CAP = 500


@router.get("", response_model=WalletSummary)
async def get_wallet_summary(
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get citizen wallet overview including live balance, monthly earned points, and cap progress.
    """
    # Total spendable balance: SUM(amount)
    bal_stmt = select(func.coalesce(func.sum(PointsLedger.amount), 0)).where(
        PointsLedger.user_id == user.id
    )
    balance = (await db.execute(bal_stmt)).scalar() or 0

    # Monthly earned in IST: SUM(amount) where type = 'earned' and current month in IST
    month_stmt = select(func.coalesce(func.sum(PointsLedger.amount), 0)).where(
        PointsLedger.user_id == user.id,
        PointsLedger.type == LedgerType.earned,
        func.date_trunc("month", func.timezone("Asia/Kolkata", PointsLedger.created_at))
        == func.date_trunc("month", func.timezone("Asia/Kolkata", func.now())),
    )
    monthly_points = (await db.execute(month_stmt)).scalar() or 0

    progress_pct = round(min(100.0, max(0.0, (monthly_points / float(MONTHLY_CAP)) * 100.0)), 1)

    return WalletSummary(
        balance=int(balance),
        monthlyPoints=int(monthly_points),
        monthlyCap=MONTHLY_CAP,
        monthlyProgressPercent=progress_pct,
    )


@router.get("/transactions", response_model=PaginatedTransactions)
async def list_wallet_transactions(
    type_filter: Optional[str] = Query(None, alias="type", pattern="^(earned|redeemed)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    List immutable points ledger transactions for the authenticated user.
    """
    stmt = select(PointsLedger).where(PointsLedger.user_id == user.id)
    if type_filter:
        stmt = stmt.where(PointsLedger.type == LedgerType(type_filter))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_count = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * limit
    stmt = stmt.order_by(PointsLedger.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    items = [
        PointsTransaction(
            id=f"tx-{row.id}",
            title=row.description or ("Earned reward" if row.amount > 0 else "Redeemed voucher"),
            points=row.amount,
            date=row.created_at.isoformat(),
            type="earned" if row.amount > 0 else "redeemed",
        )
        for row in rows
    ]

    total_pages = math.ceil(total_count / limit) if total_count > 0 else 1
    has_next_page = page < total_pages

    meta = PaginationMeta(
        page=page,
        limit=limit,
        totalItems=total_count,
        totalPages=total_pages,
        hasNextPage=has_next_page,
    )
    return PaginatedTransactions(items=items, meta=meta)
