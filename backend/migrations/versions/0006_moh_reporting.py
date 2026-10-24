"""MOH reporting chain on incidents: escalation, notification and RCA

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-24 21:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

J = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    op.add_column('incidents', sa.Column('escalated', J, nullable=True))
    op.add_column('incidents', sa.Column('moh', J, nullable=True))
    op.add_column('incidents', sa.Column('rca_due', sa.DateTime(timezone=True), nullable=True))
    op.add_column('incidents', sa.Column('rca', J, nullable=True))


def downgrade() -> None:
    for c in ('rca', 'rca_due', 'moh', 'escalated'):
        op.drop_column('incidents', c)
