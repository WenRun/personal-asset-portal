"""收藏改为按用户隔离：新增 user_favorites 表，存量全局收藏划给最早的 admin，删除 assets.is_favorite

Revision ID: d7e2b9f4a1c3
Revises: b8e4f6a2c1d7
Create Date: 2026-10-18 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd7e2b9f4a1c3'
down_revision: Union[str, Sequence[str], None] = 'b8e4f6a2c1d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_favorites',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 存量全局收藏 → 最早的 admin（无 admin 则最早的注册用户），保证升级后管理员仍能看到原有收藏
    op.execute("""
        INSERT INTO user_favorites (user_id, asset_id)
        SELECT (
            SELECT u.id FROM users u
            ORDER BY (u.role = 'admin') DESC, u.created_at ASC
            LIMIT 1
        ), a.id
        FROM assets a
        WHERE a.is_favorite AND a.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM users)
        ON CONFLICT DO NOTHING
    """)
    op.drop_column('assets', 'is_favorite')


def downgrade() -> None:
    op.add_column('assets', sa.Column('is_favorite', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.drop_table('user_favorites')
