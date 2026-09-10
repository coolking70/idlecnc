#!/usr/bin/env bash
# tools/bootstrap-preview-application.sh
#
# OpenMMO Preview —— application bootstrap worker（与 nginx 生命周期完全隔离）
#
# 职责：
#   - 做应用准备（前端/资源/后端/地形等）。本轮只做极简状态记录，
#     以最快验证 nginx :8686 生命周期稳定（后续轮次再扩展真实准备）。
#
# 隔离约束（本轮 hotfix 硬性要求）：
#   - 本 worker 是独立后台进程，由 run-preview.sh 启动（&）。
#   - worker 失败/崩溃【不得】杀掉 nginx owner。
#   - 禁止 kill 0（会误杀整组进程，包括 nginx/shell）。
#   - 禁止在错误路径 pkill nginx / nginx -s stop。
#   - 无 EXIT cleanup trap（避免正常退出误杀其他进程）。
set -u

ROOT=/workspace
LOG_DIR="$ROOT/.preview-logs"
STATUS_FILE="$ROOT/.preview-status.json"
mkdir -p "$LOG_DIR"

# 独立日志，避免与本 worker 失败混淆
LOG="$LOG_DIR/application-bootstrap.log"

log() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)][bootstrap] $*" >> "$LOG"
}

write_status() {
    # 原子写入状态文件（基础设施与应用的解耦状态）
    printf '{"ts":"%s","stage":"%s","ok":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" > "${STATUS_FILE}.tmp"
    mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

log "bootstrap worker start pid=$$ ppid=$PPID"
write_status "bootstrap-start" "true"

# ---- 极简应用准备（本轮只验证基础设施，不做重型 build） ----
# 后续轮次可在下方展开 frontend / assets / terrain / backend。
# 目的：先证明 nginx 30s+ 稳定，再接入真实应用准备。

# 记录静态站点可访问性判断依据
if [ -f "$ROOT/index.html" ]; then
    log "index.html present, static preview content available"
    write_status "bootstrap-done" "true"
    log "bootstrap worker completed successfully"
    exit 0
else
    log "index.html missing"
    write_status "bootstrap-failed" "false"
    log "APPLICATION_BOOTSTRAP_FAILED: index.html not found (nginx remains alive)"
    exit 1
fi
