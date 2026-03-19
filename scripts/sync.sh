#!/usr/bin/env bash
set -euo pipefail

# ============ 配置区域（按需修改）============

# 是否在本地 rebase 完成后自动 push 到 origin
# 可通过环境变量覆盖：AUTO_PUSH=false ./scripts/sync.sh
AUTO_PUSH="${AUTO_PUSH:-true}"

# =========================================

info()  { printf '%s\n' "$*"; }
blank() { printf '\n';        }

normalize_github_remote() {
  local remote_url="$1"

  case "$remote_url" in
    git@github.com:*)
      remote_url="${remote_url#git@github.com:}"
      ;;
    https://github.com/*)
      remote_url="${remote_url#https://github.com/}"
      ;;
    http://github.com/*)
      remote_url="${remote_url#http://github.com/}"
      ;;
  esac

  remote_url="${remote_url%.git}"
  printf '%s\n' "$remote_url"
}

# 检查是否在 git 仓库中
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  info "当前目录不是 git 仓库，请先 cd 到项目目录下再执行。"
  exit 1
fi

# 当前分支
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  info "当前处于游离 HEAD 状态，请先切换到具体分支后再执行。"
  exit 1
fi

info "当前分支: $CURRENT_BRANCH"

# 检查是否存在 origin 远程
if ! git remote get-url origin >/dev/null 2>&1; then
  info "未检测到 origin 远程仓库，请先配置远程仓库后再执行。"
  exit 1
fi

# 检查是否存在 upstream 远程
if ! git remote get-url upstream >/dev/null 2>&1; then
  info "未检测到 upstream 远程仓库。"

  # 推断当前项目名（使用仓库根目录名）
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  PROJECT_NAME="$(basename "$REPO_ROOT")"

  # 默认上游地址
  DEFAULT_UPSTREAM_URL="git@github.com:yeying-community/${PROJECT_NAME}.git"

  # 提示用户，可直接回车使用默认值
  printf '请输入上游仓库（原始项目）的 Git URL\n'
  printf '默认: %s\n' "$DEFAULT_UPSTREAM_URL"
  read -rp "直接回车使用默认地址，或输入自定义 URL: " UPSTREAM_URL

  # 如果用户没有输入，则使用默认地址
  if [ -z "${UPSTREAM_URL:-}" ]; then
    UPSTREAM_URL="$DEFAULT_UPSTREAM_URL"
  fi

  info "添加 upstream -> $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
fi

# 确保工作区干净
if ! git diff --quiet || ! git diff --cached --quiet; then
  info "检测到有未提交的更改，请先提交或暂存 (stash) 后再执行本脚本。"
  exit 1
fi

ORIGIN_URL="$(git remote get-url origin)"
UPSTREAM_URL="$(git remote get-url upstream)"

NORMALIZED_ORIGIN_URL="$(normalize_github_remote "$ORIGIN_URL")"
NORMALIZED_UPSTREAM_URL="$(normalize_github_remote "$UPSTREAM_URL")"

info "当前远程："
git remote -v

if [ "$NORMALIZED_ORIGIN_URL" = "$NORMALIZED_UPSTREAM_URL" ]; then
  blank
  info "检测到 origin 和 upstream 指向同一个仓库：$NORMALIZED_ORIGIN_URL"
  info "退化为直接同步并推送当前远端分支..."
  git pull --rebase origin "$CURRENT_BRANCH"

  if [ "$AUTO_PUSH" = "true" ]; then
    blank
    info "准备将更新推送到 origin/$CURRENT_BRANCH..."
    git push origin "$CURRENT_BRANCH"
    info "已推送到 origin/$CURRENT_BRANCH"
  else
    blank
    info "未自动推送到 origin。若需要，请手动执行："
    info "  git push origin $CURRENT_BRANCH"
  fi

  blank
  info "同步完成。"
  exit 0
fi

blank
info "从 upstream 拉取最新代码..."
git fetch upstream

UPSTREAM_BRANCH="upstream/$CURRENT_BRANCH"

# 检查 upstream 是否有对应分支
if ! git show-ref --verify --quiet "refs/remotes/$UPSTREAM_BRANCH"; then
  info "upstream 仓库中不存在分支: $UPSTREAM_BRANCH"
  info "请确认当前分支名与上游分支是否一致。"
  exit 1
fi

blank
info "使用 rebase 将本地分支 $CURRENT_BRANCH 变基到 $UPSTREAM_BRANCH 上..."
git rebase "$UPSTREAM_BRANCH"

blank
info "rebase 完成，本地分支 $CURRENT_BRANCH 已同步到 $UPSTREAM_BRANCH"

if [ "$AUTO_PUSH" = "true" ]; then
  blank
  info "准备将更新推送到 origin/$CURRENT_BRANCH..."
  git push origin "$CURRENT_BRANCH"
  info "已推送到 origin/$CURRENT_BRANCH"
else
  blank
  info "未自动推送到 origin。若需要，请手动执行："
  info "  git push origin $CURRENT_BRANCH"
fi

blank
info "同步完成。"
