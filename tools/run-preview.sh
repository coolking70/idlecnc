#!/usr/bin/env bash
# tools/run-preview.sh
#
# OpenMMO Preview —— CNB 启动入口（Architecture A）
#
# 进程模型：
#   CNB daemon launch
#       └── run-preview.sh
#             ├── application bootstrap worker &
#             └── exec nginx -g 'daemon off;'
#
# 关键点：
#   - nginx 是【唯一】长期 foreground owner。
#   - 脚本最后通过 `exec` 被 nginx 替换，因此脚本【不会】执行到 EOF 后退出。
#   - 无全局 EXIT cleanup trap（避免正常启动路径误杀 nginx/worker）。
#   - bootstrap worker 生命周期与 nginx 完全隔离。
set -Eeuo pipefail

ROOT=/workspace
LOG_DIR="$ROOT/.preview-logs"
NGINX_CONF="$ROOT/tools/nginx-openmmo.conf"
mkdir -p "$LOG_DIR"

LOG="$LOG_DIR/launcher.log"

# ---------- stdout 可观测性标记 ----------
# CNB 外层 daemon wrapper 可能不会透出这些 stdout，真正可观测性以 $LOG 为准。
echo "OPENMMO_LAUNCH_MARKER_01"
echo "launch pid=$$"
date
pwd

{
    echo "=== OPENMMO PREVIEW LAUNCH ==="
    echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "launch_pid=$$ ppid=$PPID"
    echo "pwd=$(pwd)"
    echo "nginx_conf=$NGINX_CONF"
} >> "$LOG"

# ---------- 基础设施校验（不启动服务） ----------
echo "=== NGINX VALIDATION ==="
if nginx -t -c "$NGINX_CONF" >> "$LOG" 2>&1; then
    echo "nginx config: OK" | tee -a "$LOG"
else
    echo "nginx config: INVALID" | tee -a "$LOG"
    exit 1
fi

# 验证 effective listen 确实为 8686
if nginx -T -c "$NGINX_CONF" 2>/dev/null | grep -qE 'listen[[:space:]]+0\.0\.0\.0:8686'; then
    echo "nginx listen 0.0.0.0:8686: confirmed" | tee -a "$LOG"
else
    echo "nginx listen 8686: NOT FOUND" | tee -a "$LOG"
    exit 1
fi

# ---------- 启动 application bootstrap worker（后台、独立生命周期） ----------
echo "=== START APPLICATION BOOTSTRAP ==="
bash "$ROOT/tools/bootstrap-preview-application.sh" \
    > "$LOG_DIR/application-bootstrap.log" 2>&1 &
BOOTSTRAP_PID=$!

echo "application bootstrap pid=$BOOTSTRAP_PID" | tee -a "$LOG"

{
    echo "bootstrap_pid=$BOOTSTRAP_PID"
    echo "=== starting nginx foreground (exec) ==="
    echo "expected listen: 0.0.0.0:8686"
} >> "$LOG"

echo "OPENMMO_LAUNCH_MARKER_02_NGINX_EXEC"

# ---------- 主服务：exec 到 foreground nginx ----------
# 之后 bash 被 nginx 替换，后续代码不会执行（也不应有后续代码）。
# nginx 默认 daemonize 会 fork；`daemon off;` 关闭该行为，使其保持 foreground。
# CNB `daemon:true` 由平台负责 launch daemon 上下文，nginx 自身保持 foreground。
exec nginx -g 'daemon off;' -c "$NGINX_CONF"
