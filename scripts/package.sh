#!/usr/bin/env bash
set -euo pipefail

info() {
  printf '%s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
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
     - 若 TAG 存在，则按该 TAG 打包
     - 若 TAG 对应版本与 manifest.json.version 不一致，仅在临时打包工作区中校正版本，不改动仓库历史

  2. 不带 TAG 参数:
     - 必须位于 main 分支，且工作区干净
     - 自动同步 origin/main
     - 自动获取当前最大语义化 TAG，并在 patch 位 +1 得到发布 TAG
     - 若当前 HEAD 已经是最大 TAG 对应提交，则不打包
     - 将 manifest.json.version 对齐到发布 TAG 对应版本
     - 若版本发生变化，则自动 commit 一次
     - 自动 push main 与新 TAG，最后按该 TAG 打包

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

  if [ "$status" -ne 0 ] && [ "${DELETE_LOCAL_TAG_ON_FAILURE:-false}" = "true" ] && [ -n "${TARGET_TAG:-}" ]; then
    git -C "$REPO_ROOT" tag -d "$TARGET_TAG" >/dev/null 2>&1 || true
  fi

  exit "$status"
}

ensure_clean_worktree() {
  if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
    die "检测到未提交的更改。无参打包会自动修改 manifest.json 并提交，请先清理工作区。"
  fi
}

ensure_on_main_branch() {
  local current_branch=""

  current_branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "$MAIN_BRANCH" ]; then
    die "无参打包需要在 $MAIN_BRANCH 分支执行，当前分支为 $current_branch。"
  fi
}

copy_entry() {
  local source_path="$1"
  local entry_name=""

  entry_name="$(basename "$source_path")"
  cp -R "$source_path" "$STAGE_ROOT/$entry_name"
}

resolve_highest_semver_tag() {
  "$PYTHON_BIN" - "$REPO_ROOT" <<'PY'
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

  printf 'v%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$((BASH_REMATCH[3] + 1))"
}

tag_exists() {
  local tag_name="$1"
  git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/$tag_name" >/dev/null 2>&1
}

ref_commit() {
  git -C "$REPO_ROOT" rev-list -n 1 "$1"
}

tag_to_version() {
  local tag_name="$1"
  printf '%s\n' "${tag_name#v}"
}

read_manifest_version() {
  local manifest_path="$1"

  "$PYTHON_BIN" - "$manifest_path" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
with open(manifest_path, "r", encoding="utf-8") as fh:
    manifest = json.load(fh)

version = manifest.get("version")
if not isinstance(version, str) or not version.strip():
    raise SystemExit("manifest.json 缺少有效的 version 字段")

print(version.strip())
PY
}

write_manifest_version() {
  local manifest_path="$1"
  local target_version="$2"

  "$PYTHON_BIN" - "$manifest_path" "$target_version" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
target_version = sys.argv[2]

with open(manifest_path, "r", encoding="utf-8") as fh:
    manifest = json.load(fh)

manifest["version"] = target_version

with open(manifest_path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
}

align_manifest_version() {
  local manifest_path="$1"
  local target_version="$2"
  local current_version=""

  current_version="$(read_manifest_version "$manifest_path")"
  if [ "$current_version" = "$target_version" ]; then
    return 1
  fi

  info "同步 manifest.json 版本: $current_version -> $target_version"
  write_manifest_version "$manifest_path" "$target_version"
  return 0
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

  "$PYTHON_BIN" - "$source_dir" "$archive_path" <<'PY'
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

prepare_explicit_tag_release() {
  validate_tag "$REQUESTED_TAG"

  if ! tag_exists "$REQUESTED_TAG"; then
    info "TAG 不存在，跳过打包: $REQUESTED_TAG"
    exit 0
  fi

  TARGET_TAG="$REQUESTED_TAG"
  TARGET_REF="$REQUESTED_TAG"
  TARGET_COMMIT="$(ref_commit "$REQUESTED_TAG")"
  info "使用指定 TAG 打包: $TARGET_TAG"
}

validate_tag() {
  local tag_name="$1"

  [[ "$tag_name" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "TAG 格式不合法: $tag_name"
}

push_main_branch() {
  info "推送 $MAIN_BRANCH 到 $REMOTE_NAME/$MAIN_BRANCH ..."
  git -C "$REPO_ROOT" push "$REMOTE_NAME" "$MAIN_BRANCH"
}

create_release_tag() {
  local tag_name="$1"
  local commit_hash="$2"
  local existing_commit=""

  if tag_exists "$tag_name"; then
    existing_commit="$(ref_commit "$tag_name")"
    if [ "$existing_commit" != "$commit_hash" ]; then
      die "待创建 TAG 已存在但指向不同提交: $tag_name -> $existing_commit"
    fi
    info "本地已存在 TAG，直接尝试推送: $tag_name"
  else
    git -C "$REPO_ROOT" tag "$tag_name" "$commit_hash"
    DELETE_LOCAL_TAG_ON_FAILURE="true"
    info "已创建本地 TAG: $tag_name"
  fi

  if git -C "$REPO_ROOT" push "$REMOTE_NAME" "refs/tags/$tag_name" >/dev/null 2>&1; then
    DELETE_LOCAL_TAG_ON_FAILURE="false"
    info "已推送 TAG 到远端: $tag_name"
    return 0
  fi

  git -C "$REPO_ROOT" fetch --prune "$REMOTE_NAME" --tags >/dev/null
  if tag_exists "$tag_name"; then
    existing_commit="$(ref_commit "$tag_name")"
    if [ "$existing_commit" = "$commit_hash" ]; then
      DELETE_LOCAL_TAG_ON_FAILURE="false"
      info "远端已存在相同 TAG，继续打包: $tag_name"
      return 0
    fi
  fi

  die "推送 TAG 失败: $tag_name"
}

prepare_auto_release() {
  local latest_tag=""
  local latest_tag_commit=""
  local release_version=""
  local manifest_path=""
  local head_commit=""

  ensure_on_main_branch
  ensure_clean_worktree

  info "同步本地 $MAIN_BRANCH ..."
  git -C "$REPO_ROOT" pull --rebase "$REMOTE_NAME" "$MAIN_BRANCH"

  latest_tag="$(resolve_highest_semver_tag)"
  head_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"

  if [ -n "$latest_tag" ]; then
    latest_tag_commit="$(ref_commit "$latest_tag")"
    info "当前最大 TAG: $latest_tag ($latest_tag_commit)"
  else
    info "当前未发现语义化 TAG，将从 v0.0.1 开始。"
  fi

  info "当前 $MAIN_BRANCH 最新提交: $head_commit"

  if [ -n "$latest_tag_commit" ] && [ "$latest_tag_commit" = "$head_commit" ]; then
    info "最大 TAG 与当前 $MAIN_BRANCH 最新提交一致，无需打包。"
    exit 0
  fi

  TARGET_TAG="$(next_patch_tag "$latest_tag")"
  release_version="$(tag_to_version "$TARGET_TAG")"
  manifest_path="$REPO_ROOT/manifest.json"

  if align_manifest_version "$manifest_path" "$release_version"; then
    git -C "$REPO_ROOT" add manifest.json
    git -C "$REPO_ROOT" commit -m "chore: bump manifest version to $release_version"
    info "已提交 manifest 版本更新。"
  else
    info "manifest.json 版本已是 $release_version，无需额外提交。"
  fi

  TARGET_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  push_main_branch
  create_release_tag "$TARGET_TAG" "$TARGET_COMMIT"
  TARGET_REF="$TARGET_TAG"
}

prepare_package_tree() {
  local package_version=""
  local manifest_path=""

  SHORT_HASH="$(git -C "$REPO_ROOT" rev-parse --short=7 "$TARGET_COMMIT")"
  ARCHIVE_BASENAME="${PROJECT_NAME}-${TARGET_TAG}-${SHORT_HASH}"
  ARCHIVE_PATH="$OUTPUT_DIR/${ARCHIVE_BASENAME}.zip"

  WORKTREE_DIR="$(make_temp_dir "${PROJECT_NAME}-package-worktree")"
  STAGE_PARENT_DIR="$(make_temp_dir "${PROJECT_NAME}-package-stage")"
  STAGE_ROOT="$STAGE_PARENT_DIR/$ARCHIVE_BASENAME"

  mkdir -p "$OUTPUT_DIR" "$STAGE_ROOT"

  info "准备临时打包工作区..."
  git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" "$TARGET_REF" >/dev/null

  manifest_path="$WORKTREE_DIR/manifest.json"
  [ -f "$manifest_path" ] || die "目标版本缺少 manifest.json，无法打包。"

  package_version="$(tag_to_version "$TARGET_TAG")"
  if align_manifest_version "$manifest_path" "$package_version"; then
    info "已在临时打包工作区中校正 manifest.json.version。"
  fi

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
  create_zip_archive "$STAGE_ROOT" "$ARCHIVE_PATH"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 1 ]; then
  die "最多只支持一个可选 TAG 参数。"
fi

command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git。"

PYTHON_BIN="$(detect_python)" || die "未找到 python3/python，无法完成版本处理或 zip 生成。"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel 2>/dev/null)" || die "当前目录不是 git 仓库。"
OUTPUT_DIR="$REPO_ROOT/output"
REMOTE_NAME="${PACKAGE_REMOTE:-origin}"
MAIN_BRANCH="${PACKAGE_MAIN_BRANCH:-main}"
REQUESTED_TAG="${1:-}"
PROJECT_NAME="$(resolve_project_name)"
WORKTREE_DIR=""
STAGE_PARENT_DIR=""
STAGE_ROOT=""
TARGET_TAG=""
TARGET_REF=""
TARGET_COMMIT=""
SHORT_HASH=""
ARCHIVE_BASENAME=""
ARCHIVE_PATH=""
DELETE_LOCAL_TAG_ON_FAILURE="false"

trap cleanup EXIT INT TERM

git -C "$REPO_ROOT" remote get-url "$REMOTE_NAME" >/dev/null 2>&1 || die "未检测到远程仓库: $REMOTE_NAME"

info "同步远端 $REMOTE_NAME/$MAIN_BRANCH 与 TAG..."
git -C "$REPO_ROOT" fetch --prune "$REMOTE_NAME" "+refs/heads/$MAIN_BRANCH:refs/remotes/$REMOTE_NAME/$MAIN_BRANCH" --tags >/dev/null
git -C "$REPO_ROOT" rev-parse --verify "refs/remotes/$REMOTE_NAME/$MAIN_BRANCH" >/dev/null 2>&1 \
  || die "远程分支不存在: $REMOTE_NAME/$MAIN_BRANCH"

if [ -n "$REQUESTED_TAG" ]; then
  prepare_explicit_tag_release
else
  prepare_auto_release
fi

prepare_package_tree

info "打包完成: $ARCHIVE_PATH"
