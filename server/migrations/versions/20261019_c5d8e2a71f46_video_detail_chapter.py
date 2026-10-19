"""教程系列章节识别：video_details 加 chapter 列（第N章 → N），集数为章内序号

Revision ID: c5d8e2a71f46
Revises: d7e2b9f4a1c3
Create Date: 2026-10-19 23:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c5d8e2a71f46'
down_revision: Union[str, Sequence[str], None] = 'd7e2b9f4a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('video_details', sa.Column('chapter', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('video_details', 'chapter')
