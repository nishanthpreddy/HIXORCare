"""stopped orders (blister packs stay in the 28-day cycle)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-24 10:10:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('medication_orders', sa.Column('stopped_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('medication_orders', sa.Column('stopped_by', sa.String(length=40), sa.ForeignKey('staff.id'), nullable=True))
    op.add_column('medication_orders', sa.Column('stop_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('medication_orders', 'stop_reason')
    op.drop_column('medication_orders', 'stopped_by')
    op.drop_column('medication_orders', 'stopped_at')
