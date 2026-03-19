#!/usr/bin/env bash
set -euo pipefail

info() {
  printf '%s\n' "$*"
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法:
  ./scripts/package.sh [TAG]

说明:
  1. 带 TAG 参数:
     - TAG 格式必须为 v<major>.<minor>.<patch>
     - 若 TAG 不存在，则不打包
     - 若 TAG 存在，则直接按该 TAG 打包

  2. 不带 TAG 参数:
     - 自动获取当前仓库最大的语义化 TAG
     - 比较该 TAG 与 origin/main 最新提交
     - 若提交一致，则不打包
     - 若提交不一致，则自动递增 patch，创建并推送新 TAG 后再打包

输出目录:
  output/

打包内容:
  - 排除目录: scripts/、output/、docs/、examples/
  - 其余仓库内容统一打入 zip
  - git 元数据不会进入压缩包

可选环境变量:
  PACKAGE_REMOTE       远程名，默认 origin
  PACKAGE_MAIN_BRANCH  主分支名，默认 main
EOF
}

make_temp_dir() {
  local prefix="$1"
  local base_dir="${TMPDIR:-/tmp}"

  mktemp -d "${base_dir%/}/${prefix}.XXXXXX" 2>/dev/null || mktemp -d -t "$prefix"
}

detect_python() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi

  return 1
}

cleanup() {
  local status=$?

  if [ -n "${WORKTREE_DIR:-}" ] && [ -d "${WORKTREE_DIR:-}" ]; then
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
    rm -rf "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi

  if [ -n "${STAGE_PARENT_DIR:-}" ] && [ -d "${STAGE_PARENT_DIR:-}" ]; then
    rm -rf "$STAGE_PARENT_DIR" >/dev/null 2>&1 || true
  fi

  exit "$status"
}

copy_entry() {
  local source_path="$1"
  local entry_name=""

  entry_name="$(basename "$source_path")"
  cp -R "$source_path" "$STAGE_ROOT/$entry_name"
}

resolve_highest_semver_tag() {
  local python_bin="$1"

  "$python_bin" - "$REPO_ROOT" <<'PY'
import os
import re
import subprocess
import sys

repo_root = sys.argv[1]
output = subprocess.check_output(
    ["git", "-C", repo_root, "tag", "--list"],
    text=True
).splitlines()

versions = []
for tag in output:
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", tag)
    if match:
        versions.append((tuple(int(part) for part in match.groups()), tag))

if versions:
    versions.sort()
    print(versions[-1][1])
PY
}

next_patch_tag() {
  local current_tag="$1"

  if [ -z "$current_tag" ]; then
    printf '%s\n' "v0.0.1"
    return 0
  fi

  if [[ ! "$current_tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    die "无法解析当前 TAG: $current_tag"
  fi

  local major="${BASH_REMATCH[1]}"
  local minor="${BASH_REMATCH[2]}"
  local patch="${BASH_REMATCH[3]}"

  patch=$((patch + 1))
  printf 'v%s.%s.%s\n' "$major" "$minor" "$patch"
}

tag_exists() {
  local tag_name="$1"
  git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/$tag_name" >/dev/null 2>&1
}

create_zip_archive() {
  local source_dir="$1"
  local archive_path="$2"

  if command -v zip >/dev/null 2>&1; then
    (
      cd "$STAGE_PARENT_DIR"
      zip -qry "$archive_path" "$(basename "$source_dir")"
    )
    return 0
  fi

  local python_bin="$3"

  "$python_bin" - "$source_dir" "$archive_path" <<'PY'
import os
import sys
import time
import zipfile

source_dir = os.path.abspath(sys.argv[1])
archive_path = os.path.abspath(sys.argv[2])
base_dir = os.path.dirname(source_dir)

with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(source_dir):
        dirs.sort()
        files.sort()

        rel_root = os.path.relpath(root, base_dir)
        if rel_root != ".":
            st = os.stat(root)
            info = zipfile.ZipInfo(rel_root.rstrip("/") + "/")
            info.date_time = time.localtime(st.st_mtime)[:6]
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (st.st_mode & 0xFFFF) << 16
            zf.writestr(info, b"")

        for name in files:
            file_path = os.path.join(root, name)
            rel_path = os.path.relpath(file_path, base_dir)
            info = zipfile.ZipInfo.from_file(file_path, arcname=rel_path)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(file_path, "rb") as handle:
                zf.writestr(info, handle.read())
PY
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 1 ]; then
  die "最多只支持一个可选 TAG 参数。"
fi

command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git。"

PYTHON_BIN="$(detect_python)" || die "未找到 python3/python，无法完成 TAG 排序或 zip 生成。"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel 2>/dev/null)" || die "当前目录不是 git 仓库。"
OUTPUT_DIR="$REPO_ROOT/output"
REMOTE_NAME="${PACKAGE_REMOTE:-origin}"
MAIN_BRANCH="${PACKAGE_MAIN_BRANCH:-main}"
REQUESTED_TAG="${1:-}"
WORKTREE_DIR=""
STAGE_PARENT_DIR=""
STAGE_ROOT=""

trap cleanup EXIT INT TERM

git -C "$REPO_ROOT" remote get-url "$REMOTE_NAME" >/dev/null 2>&1 || die "未检测到远程仓库: $REMOTE_NAME"

resolve_project_name() {
  local remote_url=""

  remote_url="$(git -C "$REPO_ROOT" remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
  case "$remote_url" in
    *://*|*@*)
      remote_url="${remote_url%/}"
      remote_url="${remote_url##*:}"
      remote_url="${remote_url##*/}"
      remote_url="${remote_url%.git}"
      if [ -n "$remote_url" ]; then
        printf '%s\n' "$remote_url"
        return 0
      fi
      ;;
  esac

  basename "$REPO_ROOT"
}

PROJECT_NAME="$(resolve_project_name)"

info "同步远端 $REMOTE_NAME/$MAIN_BRANCH 与 TAG..."
git -C "$REPO_ROOT" fetch --prune "$REMOTE_NAME" "+refs/heads/$MAIN_BRANCH:refs/remotes/$REMOTE_NAME/$MAIN_BRANCH" --tags >/dev/null

git -C "$REPO_ROOT" rev-parse --verify "refs/remotes/$REMOTE_NAME/$MAIN_BRANCH" >/dev/null 2>&1 \
  || die "远程分支不存在: $REMOTE_NAME/$MAIN_BRANCH"

TARGET_REF=""
TARGET_TAG=""
TARGET_COMMIT=""

if [ -n "$REQUESTED_TAG" ]; then
  [[ "$REQUESTED_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "TAG 格式不合法: $REQUESTED_TAG"

  if ! tag_exists "$REQUESTED_TAG"; then
    info "TAG 不存在，跳过打包: $REQUESTED_TAG"
    exit 0
  fi

  TARGET_TAG="$REQUESTED_TAG"
  TARGET_REF="$REQUESTED_TAG"
  TARGET_COMMIT="$(git -C "$REPO_ROOT" rev-list -n 1 "$REQUESTED_TAG")"
  info "使用指定 TAG 打包: $TARGET_TAG"
else
  LATEST_TAG="$(resolve_highest_semver_tag "$PYTHON_BIN")"
  MAIN_COMMIT="$(git -C "$REPO_ROOT" rev-parse "$REMOTE_NAME/$MAIN_BRANCH")"
  LATEST_TAG_COMMIT=""
  LOCAL_MAIN_COMMIT=""

  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$MAIN_BRANCH"; then
    LOCAL_MAIN_COMMIT="$(git -C "$REPO_ROOT" rev-parse "$MAIN_BRANCH")"
    if [ "$LOCAL_MAIN_COMMIT" != "$MAIN_COMMIT" ]; then
      info "检测到本地 $MAIN_BRANCH 与 $REMOTE_NAME/$MAIN_BRANCH 不一致，打包将以远端同步后的代码为准。"
    fi
  fi

  if [ -n "$LATEST_TAG" ]; then
    LATEST_TAG_COMMIT="$(git -C "$REPO_ROOT" rev-list -n 1 "$LATEST_TAG")"
    info "当前最大 TAG: $LATEST_TAG ($LATEST_TAG_COMMIT)"
  else
    info "当前未发现语义化 TAG，将从 v0.0.1 开始。"
  fi

  info "$REMOTE_NAME/$MAIN_BRANCH 最新提交: $MAIN_COMMIT"

  if [ -n "$LATEST_TAG_COMMIT" ] && [ "$LATEST_TAG_COMMIT" = "$MAIN_COMMIT" ]; then
    info "最大 TAG 与 $REMOTE_NAME/$MAIN_BRANCH 最新提交一致，无需打包。"
    exit 0
  fi

  TARGET_TAG="$(next_patch_tag "$LATEST_TAG")"
  TARGET_COMMIT="$MAIN_COMMIT"

  if tag_exists "$TARGET_TAG"; then
    EXISTING_TAG_COMMIT="$(git -C "$REPO_ROOT" rev-list -n 1 "$TARGET_TAG")"
    if [ "$EXISTING_TAG_COMMIT" != "$MAIN_COMMIT" ]; then
      die "待创建 TAG 已存在但指向不同提交: $TARGET_TAG -> $EXISTING_TAG_COMMIT"
    fi
    info "本地已存在 TAG，直接尝试推送: $TARGET_TAG"
  else
    git -C "$REPO_ROOT" tag "$TARGET_TAG" "$MAIN_COMMIT"
    DELETE_LOCAL_TAG_ON_FAILURE="true"
    info "已创建本地 TAG: $TARGET_TAG"
  fi

  if git -C "$REPO_ROOT" push "$REMOTE_NAME" "refs/tags/$TARGET_TAG" >/dev/null 2>&1; then
    DELETE_LOCAL_TAG_ON_FAILURE="false"
    info "已推送 TAG 到远端: $TARGET_TAG"
  else
    git -C "$REPO_ROOT" fetch --prune "$REMOTE_NAME" --tags >/dev/null
    if tag_exists "$TARGET_TAG"; then
      REMOTE_TAG_COMMIT="$(git -C "$REPO_ROOT" rev-list -n 1 "$TARGET_TAG")"
      if [ "$REMOTE_TAG_COMMIT" = "$MAIN_COMMIT" ]; then
        DELETE_LOCAL_TAG_ON_FAILURE="false"
        info "远端已存在相同 TAG，继续打包: $TARGET_TAG"
      else
        die "推送 TAG 失败，且远端同名 TAG 指向不同提交: $TARGET_TAG -> $REMOTE_TAG_COMMIT"
      fi
    else
      die "推送 TAG 失败: $TARGET_TAG"
    fi
  fi

  TARGET_REF="$TARGET_TAG"
fi

SHORT_HASH="$(git -C "$REPO_ROOT" rev-parse --short=7 "$TARGET_COMMIT")"
ARCHIVE_BASENAME="${PROJECT_NAME}-${TARGET_TAG}-${SHORT_HASH}"
ARCHIVE_PATH="$OUTPUT_DIR/${ARCHIVE_BASENAME}.zip"

WORKTREE_DIR="$(make_temp_dir "${PROJECT_NAME}-package-worktree")"
STAGE_PARENT_DIR="$(make_temp_dir "${PROJECT_NAME}-package-stage")"
STAGE_ROOT="$STAGE_PARENT_DIR/$ARCHIVE_BASENAME"

mkdir -p "$OUTPUT_DIR" "$STAGE_ROOT"

info "准备临时打包工作区..."
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$TARGET_REF" >/dev/null

shopt -s dotglob nullglob
for entry in "$WORKTREE_DIR"/*; do
  entry_name="$(basename "$entry")"
  case "$entry_name" in
    .git|scripts|output|docs|examples)
      continue
      ;;
  esac
  copy_entry "$entry"
done
shopt -u dotglob nullglob

info "已排除 scripts/、output/、docs/、examples/ 目录，其余仓库内容全部打包。"

rm -f "$ARCHIVE_PATH"
create_zip_archive "$STAGE_ROOT" "$ARCHIVE_PATH" "$PYTHON_BIN"

info "打包完成: $ARCHIVE_PATH"
