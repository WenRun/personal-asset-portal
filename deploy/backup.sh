#!/usr/bin/env bash
# 备份脚本（详细设计 §12/§13 M6）：pg_dump + rsync 原始文件；派生物可重建不备份。
# 用法：DATABASE_URL=postgresql://postgres:***@localhost:5432/portal BACKUP_DIR=/path/to/backups ./backup.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?需要 DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
LIBRARY_DIR="${LIBRARY_DIR:-$(dirname "$0")/../server/data/library}"
KEEP_DAYS="${KEEP_DAYS:-14}"

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# 1) 数据库（从 DATABASE_URL 解析；仅支持 postgresql:// 形式）
PG_URL=$(echo "$DATABASE_URL" | sed 's|postgresql+asyncpg://|postgresql://|')
pg_dump "$PG_URL" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
echo "db backup: $BACKUP_DIR/db-$STAMP.sql.gz"

# 2) 原始文件（library/：五类资源根 + uploads 暂存）
rsync -a --delete "$LIBRARY_DIR/" "$BACKUP_DIR/library/"
echo "library synced: $BACKUP_DIR/library/"

# 3) 清理过期备份
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "done (保留 $KEEP_DAYS 天)"
