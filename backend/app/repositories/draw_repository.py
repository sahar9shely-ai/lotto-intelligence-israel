from __future__ import annotations

from datetime import date
from typing import Literal, Optional, Sequence
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.phase1 import DrawNumber, GameRule, LotteryDraw, StrongNumber

DrawSort = Literal["draw_date_desc", "draw_date_asc", "draw_number_desc", "draw_number_asc"]


class DrawRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_draws(
        self,
        *,
        game_code: Optional[str] = None,
        game_variant: Optional[str] = None,
        rule_version: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        is_current: bool = True,
        page: int = 1,
        page_size: int = 50,
        sort: DrawSort = "draw_date_desc",
    ) -> tuple[int, Sequence[LotteryDraw]]:
        base_stmt: Select[tuple[LotteryDraw]] = (
            select(LotteryDraw)
            .join(GameRule, LotteryDraw.game_rule_id == GameRule.game_rule_id)
            .where(LotteryDraw.is_current == is_current)
            .options(selectinload(LotteryDraw.numbers), selectinload(LotteryDraw.strong_numbers))
        )

        count_stmt = (
            select(func.count())
            .select_from(LotteryDraw)
            .join(GameRule, LotteryDraw.game_rule_id == GameRule.game_rule_id)
            .where(LotteryDraw.is_current == is_current)
        )

        if game_code:
            base_stmt = base_stmt.where(GameRule.game_code == game_code)
            count_stmt = count_stmt.where(GameRule.game_code == game_code)
        if game_variant:
            base_stmt = base_stmt.where(GameRule.game_variant == game_variant)
            count_stmt = count_stmt.where(GameRule.game_variant == game_variant)
        if rule_version:
            base_stmt = base_stmt.where(GameRule.rule_version == rule_version)
            count_stmt = count_stmt.where(GameRule.rule_version == rule_version)
        if from_date:
            base_stmt = base_stmt.where(LotteryDraw.draw_date >= from_date)
            count_stmt = count_stmt.where(LotteryDraw.draw_date >= from_date)
        if to_date:
            base_stmt = base_stmt.where(LotteryDraw.draw_date <= to_date)
            count_stmt = count_stmt.where(LotteryDraw.draw_date <= to_date)

        if sort == "draw_date_asc":
            base_stmt = base_stmt.order_by(LotteryDraw.draw_date.asc(), LotteryDraw.draw_number.asc())
        elif sort == "draw_number_desc":
            base_stmt = base_stmt.order_by(LotteryDraw.draw_number.desc(), LotteryDraw.draw_date.desc())
        elif sort == "draw_number_asc":
            base_stmt = base_stmt.order_by(LotteryDraw.draw_number.asc(), LotteryDraw.draw_date.asc())
        else:
            base_stmt = base_stmt.order_by(LotteryDraw.draw_date.desc(), LotteryDraw.draw_number.desc())

        total_count = self.db.execute(count_stmt).scalar_one()
        offset = (page - 1) * page_size
        items = self.db.execute(base_stmt.offset(offset).limit(page_size)).scalars().all()
        return total_count, items

    def get_draw_by_uid(self, *, draw_uid: UUID, include_history: bool = False) -> Optional[LotteryDraw]:
        stmt: Select[tuple[LotteryDraw]] = (
            select(LotteryDraw)
            .options(
                selectinload(LotteryDraw.numbers),
                selectinload(LotteryDraw.strong_numbers),
                selectinload(LotteryDraw.game_rule),
            )
            .where(LotteryDraw.draw_uid == draw_uid)
            .where(LotteryDraw.is_current.is_(True))
            .limit(1)
        )
        draw = self.db.execute(stmt).scalars().first()
        if draw:
            return draw

        if include_history:
            history_stmt: Select[tuple[LotteryDraw]] = (
                select(LotteryDraw)
                .options(
                    selectinload(LotteryDraw.numbers),
                    selectinload(LotteryDraw.strong_numbers),
                    selectinload(LotteryDraw.game_rule),
                )
                .where(LotteryDraw.draw_uid == draw_uid)
                .order_by(LotteryDraw.source_revision.desc())
                .limit(1)
            )
            return self.db.execute(history_stmt).scalars().first()

        return None

    def get_regular_numbers(self, *, draw_revision_id: int) -> Sequence[DrawNumber]:
        stmt: Select[tuple[DrawNumber]] = (
            select(DrawNumber)
            .where(DrawNumber.draw_revision_id == draw_revision_id)
            .order_by(DrawNumber.position_no.asc())
        )
        return self.db.execute(stmt).scalars().all()

    def get_strong_numbers(self, *, draw_revision_id: int) -> Sequence[StrongNumber]:
        stmt: Select[tuple[StrongNumber]] = (
            select(StrongNumber)
            .where(StrongNumber.draw_revision_id == draw_revision_id)
            .order_by(StrongNumber.position_no.asc())
        )
        return self.db.execute(stmt).scalars().all()

