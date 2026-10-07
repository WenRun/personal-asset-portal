"""jobs.started_at: 任务本次执行开始时间（区分排队等待与实际执行，用于准确计算耗时）

Revision ID: b3f9a1c27d44
Revises: e256f2a718d5
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b3f9a1c27d44'
down_revision: Union[str, Sequence[str], None] = 'e256f2a718d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """加 started_at 列；存量运行中任务以 run_at 兜底，历史已完成任务留空（前端回退用创建时间）。"""
    op.add_column('jobs', sa.Column('started_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE jobs SET started_at = run_at WHERE status = 'running'")


def downgrade() -> None:
    op.drop_column('jobs', 'started_at')
