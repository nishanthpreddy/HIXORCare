"""incidents and post-fall neuro checks

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24 12:45:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

J = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    op.create_table(
        'incidents',
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('resident_id', sa.String(length=40), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reported_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('by_id', sa.String(length=40), nullable=False),
        sa.Column('place', sa.Text(), nullable=False),
        sa.Column('what', sa.Text(), nullable=False),
        sa.Column('injury', sa.Text(), nullable=False),
        sa.Column('harm', sa.Integer(), nullable=False),
        sa.Column('action', sa.Text(), nullable=False),
        sa.Column('fall', J, nullable=True),
        sa.Column('told', J, nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('review', J, nullable=True),
        sa.Column('review_by', sa.String(length=40), nullable=True),
        sa.Column('review_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_by', sa.String(length=40), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('close_summary', sa.Text(), nullable=True),
        sa.Column('moh_due', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['by_id'], ['staff.id']),
        sa.ForeignKeyConstraint(['closed_by'], ['staff.id']),
        sa.ForeignKeyConstraint(['resident_id'], ['residents.id']),
        sa.ForeignKeyConstraint(['review_by'], ['staff.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_incidents_at'), 'incidents', ['at'], unique=False)
    op.create_index(op.f('ix_incidents_resident_id'), 'incidents', ['resident_id'], unique=False)
    op.add_column('vitals', sa.Column('neuro', J, nullable=True))


def downgrade() -> None:
    op.drop_column('vitals', 'neuro')
    op.drop_index(op.f('ix_incidents_resident_id'), table_name='incidents')
    op.drop_index(op.f('ix_incidents_at'), table_name='incidents')
    op.drop_table('incidents')
