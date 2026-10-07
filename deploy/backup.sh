#!/usr/bin/env bash
# 备份脚本（详细设计 §12/§13 M6）：pg_dump + rsync 原始文件；派生物可重建不备份。
# 用法（宿主机直连 PG，开发形态）：
#   DATABASE_URL=postgresql://postgres:***@localhost:5432/portal BACKUP_DIR=/path/to/backups ./backup.sh
# 用法（容器化 PG，生产形态 2026-10-07）：
#   PG_CONTAINER=postgres PG_USER=portal BACKUP_DIR=/path/to/backups ./backup.sh
#   （经 docker exec 在 PG 容器内执行 pg_dump；DATABASE_URL 仍用于解析库名）
# library 目录：生产 compose 用命名卷 portal_data，可设 LIBRARY_DIR 指向宿主挂载路径，
#   或用一次性容器导出：
#   docker run --rm -v <项目>_portal_data:/data:ro -v "$BACKUP_DIR":/backup alpine \
#     tar czf /backup/library-$STAMP.tar.gz -C /data library
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?需要 DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
LIBRARY_DIR="${LIBRARY_DIR:-$(dirname "$0")/../server/data/library}"
KEEP_DAYS="${KEEP_DAYS:-14}"

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

# 1) 数据库（从 DATABASE_URL 解析；仅支持 postgresql:// 形式）
PG_URL=$(echo "$DATABASE_URL" | sed 's|postgresql+asyncpg://|postgresql://|')
if [ -n "${PG_CONTAINER:-}" ]; then
  PG_USER="${PG_USER:-$(echo "$PG_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')}"
  PG_DB="${PG_DB:-$(echo "$PG_URL" | sed -n 's|.*/\([^/?]*\)\([?].*\)\?$|\1|p')}"
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
else
  pg_dump "$PG_URL" | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"
fi
echo "db backup: $BACKUP_DIR/db-$STAMP.sql.gz"

# 2) 原始文件（library/：五类资源根 + uploads 暂存）
rsync -a --delete "$LIBRARY_DIR/" "$BACKUP_DIR/library/"
echo "library synced: $BACKUP_DIR/library/"

# 3) 清理过期备份
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "done (保留 $KEEP_DAYS 天)"
