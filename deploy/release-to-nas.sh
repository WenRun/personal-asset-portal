#!/usr/bin/env bash
#
# 一键发布到 NAS 生产环境（http://192.168.31.31:8080）
#
# 启动方式：
#   ./deploy/release-to-nas.sh                # 交互菜单（推荐）
#   ./deploy/release-to-nas.sh --commit "说明" # 非交互：提交并构建（等价菜单 1）
#   ./deploy/release-to-nas.sh --skip-push    # 非交互：直接构建（等价菜单 2）
#   ./deploy/release-to-nas.sh --branch dev   # 非交互：发布指定分支（等价菜单 3）
#
# 交互菜单：
#   1) 提交代码并构建 —— git add -A + commit（可输入说明）+ push + 同步 NAS + 重建
#   2) 直接构建       —— 不提交不推送，用当前分支已提交内容 同步 + 重建
#   3) 发布其他分支   —— 输入分支名，推送该分支 + 用该分支内容 同步 + 重建
#
# 环境变量：
#   NAS_SUDO_PASSWORD   NAS 上 sudo 所需密码（docker 命令需 sudo）。
#                       未设置时脚本会交互提示输入（不回显）。
#                       安全：不要把真实密码写进这个文件（它会被 git 跟踪/推送）。
#
# 注意：发布会替换线上代码（外部可访问），请先在本地验证改动无误再执行。

set -euo pipefail

# ---------- 配置（按需要修改） ----------
NAS_HOST="wenrun@192.168.31.31"          # SSH 直连 IP（记忆：~/.ssh/config 里的 NAS 别名已失效）
NAS_DIR="/vol1/1000/asset-portal"        # NAS 上项目的部署目录
DEFAULT_BRANCH="main"                    # 默认发布分支
# ---------- 配置结束 ----------

# 颜色（非 TTY 自动关闭）
if [[ -t 1 ]]; then
  GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; BOLD=""; RESET=""
fi
info() { printf '%s[信息]%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s[警告]%s %s\n' "$YELLOW" "$RESET" "$*"; }
err()  { printf '%s[错误]%s %s\n' "$RED" "$RESET" "$*" >&2; }

# ---------- 参数解析（非交互模式，兼容脚本化调用） ----------
ACTION="interactive"        # interactive / commit / direct / branch
AUTO_COMMIT=""
BRANCH="$DEFAULT_BRANCH"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) ACTION="commit"; AUTO_COMMIT="$2"; shift 2;;
    --skip-push) ACTION="direct"; shift;;
    --branch) ACTION="branch"; BRANCH="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//'; exit 0;;
    *) err "未知参数：$1（无参数运行进入交互菜单）"; exit 1;;
  esac
done

# 切到项目根（脚本在 deploy/ 下，上上级即仓库根）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- 交互菜单 ----------
if [[ "$ACTION" == "interactive" ]]; then
  while true; do
    echo
    echo "=============================================="
    echo "  一键发布到 NAS（$NAS_HOST:$NAS_DIR）"
    echo "  当前分支：$(git branch --show-current)"
    echo "=============================================="
    echo "  1) 提交代码并构建   （提交+推送+同步+重建）"
    echo "  2) 直接构建         （跳过提交/推送，同步+重建）"
    echo "  3) 发布其他分支     （输入分支名，推送+同步+重建）"
    echo "  q) 退出"
    echo "=============================================="
    read -r -p "请选择 [1/2/3/q]：" choice
    case "$choice" in
      1) ACTION="commit"; break;;
      2) ACTION="direct"; break;;
      3)
        read -r -p "要发布的分支名（回车= $DEFAULT_BRANCH）：" input_branch
        BRANCH="${input_branch:-$DEFAULT_BRANCH}"
        ACTION="branch"; break;;
      q|Q) echo "已退出。"; exit 0;;
      *) warn "无效输入：$choice，请输入 1/2/3 或 q";;
    esac
  done
fi

# ---------- 分支存在性校验 ----------
if ! git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  err "本地不存在分支：$BRANCH（可先 git branch -a 查看）"
  exit 1
fi

# ---------- 工作区与提交处理 ----------
CUR_BRANCH="$(git branch --show-current)"
DIRTY=$(git status --porcelain)

if [[ "$ACTION" == "commit" ]]; then
  if [[ -n "$DIRTY" ]]; then
    if [[ -z "$AUTO_COMMIT" ]]; then
      read -r -p "提交说明（回车使用默认）：" manual_msg
      AUTO_COMMIT="${manual_msg:-chore: 更新部署 $(date +%Y-%m-%d)}"
    fi
    info "提交改动：$AUTO_COMMIT"
    git add -A
    git commit -m "$AUTO_COMMIT"
  else
    info "工作区干净，无需提交。"
  fi
  if [[ "$CUR_BRANCH" != "$BRANCH" ]]; then
    warn "当前分支是 $CUR_BRANCH，将提交到 $BRANCH 并发布 $BRANCH 的内容。"
    read -r -p "确认继续？[y/N]：" ok
    [[ "${ok:-N}" =~ ^[Yy]$ ]] || { echo "已取消。"; exit 1; }
    git checkout "$BRANCH" >/dev/null 2>&1
    DIRTY=$(git status --porcelain)   # 切分支后重新检查
    if [[ -n "$DIRTY" ]]; then
      err "切到 $BRANCH 后仍有改动且无法自动处理，请手动处理。"
      git status --short
      exit 1
    fi
  fi
elif [[ "$ACTION" == "direct" ]]; then
  if [[ -n "$DIRTY" ]]; then
    warn "工作区有未提交改动 —— 直接构建只会发布已提交的内容（未提交改动不会带上）。"
    warn "若要把当前改动发出去，请选菜单 1。"
    read -r -p "仍继续？[y/N]：" ok
    [[ "${ok:-N}" =~ ^[Yy]$ ]] || { echo "已取消。"; exit 1; }
  else
    info "工作区干净，直接构建将使用 $BRANCH 已提交内容。"
  fi
else # branch
  if [[ "$CUR_BRANCH" != "$BRANCH" ]]; then
    info "当前分支 $CUR_BRANCH ≠ 发布分支 $BRANCH，将直接使用 $BRANCH 的已提交内容（不改动你当前工作区）。"
  fi
fi

# ---------- 推送 ----------
if [[ "$ACTION" == "commit" || "$ACTION" == "branch" ]]; then
  info "推送 $BRANCH 到 origin ..."
  git push origin "$BRANCH"
else
  info "跳过 git push（直接构建模式）"
fi

info "将用 $BRANCH 分支同步到 NAS（archive 只含版本库跟踪文件，NAS 的 .env 等不会被覆盖）。"

# ---------- 确定 sudo 密码（不落盘，经 stdin 喂给远端 sudo -S） ----------
SUDO_PASSWORD="${NAS_SUDO_PASSWORD:-}"
if [[ -z "$SUDO_PASSWORD" ]]; then
  read -r -s -p "NAS sudo 密码（docker 命令需要，输入不回显）：" SUDO_PASSWORD
  echo
fi

# 在 NAS 上执行一条命令，sudo 密码从本地 stdin 传入，避免出现在命令行/进程列表
remote_sudo() {
  # 用法：remote_sudo 'cd /path && docker compose ...'
  ssh -o BatchMode=yes "$NAS_HOST" "cd '$NAS_DIR' && sudo -S bash -c \"$1\"" <<<"$SUDO_PASSWORD"
}

# ---------- 同步到 NAS ----------
info "同步 $BRANCH 代码到 $NAS_HOST:$NAS_DIR ..."
ssh -o BatchMode=yes "$NAS_HOST" "mkdir -p '$NAS_DIR'"
git archive "$BRANCH" | ssh -o BatchMode=yes "$NAS_HOST" "tar -x -C '$NAS_DIR'"
echo "  ${GREEN}✓${RESET} 代码已同步"

# ---------- NAS：修复权限 ----------
info "修复 NAS 目录权限（fnOS tar 解包可能产生 000 权限位）..."
ssh -o BatchMode=yes "$NAS_HOST" "chmod -R u+rwX,go+rX '$NAS_DIR'"

# ---------- NAS：重建容器 ----------
info "重建容器（docker compose up -d --build）... 首次构建较慢，请耐心。"
if remote_sudo 'docker compose up -d --build'; then
  echo "  ${GREEN}✓${RESET} 构建启动返回成功"
else
  err "docker compose 构建返回非零（可能失败）。请查看上方日志。"
fi

# ---------- 验证 ----------
info "等待 8 秒后检查容器状态 ..."
sleep 8
echo "  ----------------------------------------"
remote_sudo 'docker compose ps' || true

echo
info "发布脚本执行完毕。"
echo "  站点：http://192.168.31.31:8080"
echo "  建议：登录后验证视频系列功能正常、无 502。"
