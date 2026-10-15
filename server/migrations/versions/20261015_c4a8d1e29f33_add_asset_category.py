"""assets.category & suggested_category: 资产分类与智能推荐分类，从既有物理目录结构回填分类

Revision ID: c4a8d1e29f33
Revises: b3f9a1c27d44
Create Date: 2026-10-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c4a8d1e29f33'
down_revision: Union[str, Sequence[str], None] = 'b3f9a1c27d44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 新增字段
    op.add_column('assets', sa.Column('category', sa.Text(), nullable=True))
    op.add_column('assets', sa.Column('suggested_category', sa.Text(), nullable=True))

    # 2. 创建联合索引
    op.create_index('idx_assets_type_category', 'assets', ['asset_type', 'category', 'deleted_at'])

    # 3. 存量资产回填（方案 A）：若 relative_path 包含子目录，以第一级目录名称作为分类
    # storage_key 格式为 "{root_alias}:{relative_path}"，排除 cue: 虚拟子资产
    op.execute("""
        UPDATE assets
        SET category = split_part(split_part(storage_key, ':', 2), '/', 1)
        WHERE storage_key NOT LIKE 'cue:%'
          AND position('/' in split_part(storage_key, ':', 2)) > 0
          AND category IS NULL;
    """)


def downgrade() -> None:
    op.drop_index('idx_assets_type_category', table_name='assets')
    op.drop_column('assets', 'suggested_category')
    op.drop_column('assets', 'category')
