"""users.email & users.phone: 用户可选联系方式，个人资料弹窗维护（均可空、不唯一）

Revision ID: b8e4f6a2c1d7
Revises: c4a8d1e29f33
Create Date: 2026-10-17 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b8e4f6a2c1d7'
down_revision: Union[str, Sequence[str], None] = 'c4a8d1e29f33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('email', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('phone', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'phone')
    op.drop_column('users', 'email')
