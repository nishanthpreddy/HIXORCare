"""second ward: ward unit and the wards each person works on

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-24 16:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

J = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    op.add_column('wards', sa.Column('unit', sa.String(length=60), nullable=False, server_default=''))
    op.add_column('staff', sa.Column('wards', J, nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('staff', 'wards')
    op.drop_column('wards', 'unit')
