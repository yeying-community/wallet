#!/usr/bin/env bash
set -euo pipefail

info()  { printf '%s\n' "$*"; }
blank() { printf '\n';        }

# ============ 可配置区域（按需修改）============

# 默认要合并到上游的分支（base），一般是 main 或 master
DEFAULT_BASE_BRANCH="main"

# 是否自动推送当前分支到 origin
AUTO_PUSH="${AUTO_PUSH:-true}"

# 是否在创建 PR 前进行交互确认
INTERACTIVE="${INTERACTIVE:-true}"

# 非交互模式下，是否自动使用最近提交信息填充 PR 标题和描述
AUTO_FILL_PR="${AUTO_FILL_PR:-true}"

# 若设置为 true，检测到 GH_TOKEN 时优先使用 gh auth login 的本地凭据
PREFER_GH_AUTH_LOGIN="${PREFER_GH_AUTH_LOGIN:-true}"

# =============================================

detect_os() {
  # 返回: darwin / linux / other
  local uname_out
  uname_out="$(uname -s)"
  case "${uname_out}" in
    Darwin*) echo "darwin" ;;
    Linux*)  echo "linux"  ;;
    *)       echo "other"  ;;
  esac
}

detect_linux_distro() {
  # 尝试读取 /etc/os-release，返回: debian/ubuntu/fedora/centos/rhel/arch/other
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID_LIKE:-$ID}" in
      *debian*) echo "debian" ;;
      *ubuntu*) echo "debian" ;; # 归为 debian
      *rhel*|*centos*|*fedora*) echo "rhel" ;;
      *fedora*) echo "fedora" ;; # 单独处理 fedora
      *arch*)   echo "arch"   ;;
      *)        echo "other"  ;;
    esac
  else
    echo "other"
  fi
}

install_gh() {
  blank
  info "未检测到 GitHub CLI 命令 gh，尝试自动安装..."

  local os distro
  os="$(detect_os)"

  if [ "$os" = "darwin" ]; then
    # macOS: 使用 brew 安装
    if command -v brew >/dev/null 2>&1; then
      info "检测到 macOS，使用 Homebrew 安装 gh..."
      brew install gh || {
        info "Homebrew 安装 gh 失败，请手动安装，参考："
        info "  https://github.com/cli/cli#installation"
        exit 1
      }
    else
      info "当前为 macOS，但未检测到 Homebrew。"
      info "请先安装 Homebrew：https://brew.sh/"
      info "然后执行：  brew install gh"
      exit 1
    fi

  elif [ "$os" = "linux" ]; then
    distro="$(detect_linux_distro)"
    case "$distro" in
      debian)
        info "检测到 Debian/Ubuntu 系 Linux，使用 apt 安装 gh..."
        if ! command -v curl >/dev/null 2>&1; then
          sudo apt update
          sudo apt install -y curl
        fi

        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
          sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
          && sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
          && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
          sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null \
          && sudo apt update \
          && sudo apt install -y gh || {
            info "apt 安装 gh 失败，请手动安装，参考："
            info "  https://github.com/cli/cli#installation"
            exit 1
          }
        ;;
      fedora)
        info "检测到 Fedora 系 Linux，使用 dnf 安装 gh..."
        sudo dnf install -y 'dnf-command(config-manager)' || true
        sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo || true
        sudo dnf install -y gh || {
          info "dnf 安装 gh 失败，请手动安装，参考："
          info "  https://github.com/cli/cli#installation"
          exit 1
        }
        ;;
      rhel)
        info "检测到 RHEL/CentOS 系 Linux，尝试使用 yum/dnf 安装 gh..."
        if command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y 'dnf-command(config-manager)' || true
          sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo || true
          sudo dnf install -y gh || {
            info "dnf 安装 gh 失败，请手动安装，参考："
            info "  https://github.com/cli/cli#installation"
            exit 1
          }
        else
          sudo yum install -y yum-utils || true
          sudo yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo || true
          sudo yum install -y gh || {
            info "yum 安装 gh 失败，请手动安装，参考："
            info "  https://github.com/cli/cli#installation"
            exit 1
          }
        fi
        ;;
      arch)
        info "检测到 Arch Linux，使用 pacman 安装 gh..."
        sudo pacman -Sy --noconfirm github-cli || {
          info "pacman 安装 gh 失败，请手动安装，参考："
          info "  https://github.com/cli/cli#installation"
          exit 1
        }
        ;;
      *)
        info "检测到 Linux，但未能识别发行版或暂不支持自动安装。"
        info "请参考官方文档手动安装 gh："
        info "  https://github.com/cli/cli#installation"
        exit 1
        ;;
    esac
  else
    info "当前系统不是常见的 macOS/Linux，脚本不支持自动安装 gh。"
    info "请参考官方文档手动安装 gh："
    info "  https://github.com/cli/cli#installation"
    exit 1
  fi

  blank
  if ! command -v gh >/dev/null 2>&1; then
    info "自动安装 gh 后仍未检测到 gh 命令，请手动确认安装是否成功。"
    exit 1
  fi

  info "GitHub CLI (gh) 已安装完成。"
}

parse_github_repo() {
  # 传入 remote url，返回 owner/repo
  local remote_url="$1"
  case "$remote_url" in
    git@github.com:*)
      local tmp="${remote_url#git@github.com:}"
      tmp="${tmp%.git}"
      printf '%s\n' "$tmp"
      ;;
    https://github.com/*)
      local tmp="${remote_url#https://github.com/}"
      tmp="${tmp%.git}"
      printf '%s\n' "$tmp"
      ;;
    *)
      printf '%s\n' ""
      ;;
  esac
}

run_gh_pr_create() {
  local base="$1"
  local head="$2"
  local -a cmd=(gh pr create --base "$base" --head "$head")

  if [ "$INTERACTIVE" != "true" ]; then
    if [ -n "${PR_TITLE:-}" ] || [ -n "${PR_BODY:-}" ]; then
      if [ -z "${PR_TITLE:-}" ] || [ -z "${PR_BODY:-}" ]; then
        info "PR_TITLE 和 PR_BODY 需要同时提供。"
        return 2
      fi
      cmd+=(--title "$PR_TITLE" --body "$PR_BODY")
    elif [ "$AUTO_FILL_PR" = "true" ]; then
      cmd+=(--fill)
    fi
  fi

  "${cmd[@]}"
}

# 封装 gh pr create，自动处理默认仓库未设置的情况
gh_pr_create_with_default_repo() {
  local base="$1"
  local head="$2"
  local output
  local status

  # 第一次尝试
  set +e
  output="$(run_gh_pr_create "$base" "$head" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    [ -n "$output" ] && info "$output"
    return 0
  fi

  if [ -n "$output" ]; then
    info "$output"
    blank
  fi

  if printf '%s' "$output" | grep -qi "Resource not accessible by personal access token"; then
    info "创建 PR 失败：GH_TOKEN 缺少权限（createPullRequest）。"
    info "解决方式："
    info "  1) 推荐：unset GH_TOKEN && gh auth login -h github.com -s repo"
    if [ -n "${UPSTREAM_REPO:-}" ]; then
      info "  2) 或为 GH_TOKEN 授予 ${UPSTREAM_REPO} 的 Pull requests: Read and write 权限"
      info "  3) 手动创建 PR：https://github.com/${UPSTREAM_REPO}/compare/${base}...${head}?expand=1"
    else
      info "  2) 或为 GH_TOKEN 授予目标仓库的 Pull requests: Read and write 权限"
    fi
    return 1
  fi

  # 可能是 default repo 未设置：先设置 upstream 后重试
  info "检测到 gh 默认仓库未设置，尝试将 upstream 设置为默认仓库..."
  if ! gh repo set-default upstream >/dev/null 2>&1; then
    blank
    info "自动设置 gh 默认仓库为 upstream 失败。"
    info "请手动执行： gh repo set-default upstream"
    exit 1
  fi

  blank
  info "已将 gh 默认仓库设置为 upstream，重试创建 PR..."

  run_gh_pr_create "$base" "$head"
}

# 1. 基础检查：git 仓库

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  info "当前目录不是 git 仓库，请先 cd 到项目目录下再执行。"
  exit 1
fi

# 2. 检查 gh，如不存在则尝试自动安装

if ! command -v gh >/dev/null 2>&1; then
  install_gh
fi

if [ "$PREFER_GH_AUTH_LOGIN" = "true" ] && [ -n "${GH_TOKEN:-}" ]; then
  info "检测到 GH_TOKEN。为避免 token 权限不足，默认忽略 GH_TOKEN，改用 gh auth login 凭据。"
  unset GH_TOKEN
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  info "未检测到 gh 登录状态，请先执行：gh auth login -h github.com -s repo"
  exit 1
fi

# 3. 当前分支 & 工作区状态检查

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  info "当前处于游离 HEAD 状态，请先切换到具体分支后再执行。"
  exit 1
fi

info "当前分支: $CURRENT_BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  info "检测到有未提交的更改，请先提交或暂存 (stash) 后再执行本脚本。"
  exit 1
fi

# 4. 确认 origin / upstream 配置

if ! git remote get-url origin >/dev/null 2>&1; then
  info "未检测到 origin 远程仓库，请先配置 fork 仓库为 origin。"
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  info "未检测到 upstream 远程仓库，请先添加上游仓库，例如："
  info "  git remote add upstream git@github.com:<upstream-owner>/<project>.git"
  exit 1
fi

ORIGIN_URL="$(git remote get-url origin)"
UPSTREAM_URL="$(git remote get-url upstream)"
UPSTREAM_REPO="$(parse_github_repo "$UPSTREAM_URL")"

info "origin:   $ORIGIN_URL"
info "upstream: $UPSTREAM_URL"

blank

# 5. 推送当前分支到 origin

if [ "$AUTO_PUSH" = "true" ]; then
  info "将当前分支推送到 origin/$CURRENT_BRANCH ..."
  git push origin "$CURRENT_BRANCH"
  info "已推送到 origin/$CURRENT_BRANCH"
else
  info "AUTO_PUSH = false，跳过自动推送。"
  info "如需要，请手动执行："
  info "  git push origin $CURRENT_BRANCH"
fi

blank

# 6. 确定 base 分支（上游目标分支）

BASE_BRANCH="${1:-$DEFAULT_BASE_BRANCH}"

info "将从 fork 分支:  $(git config user.name 2>/dev/null || echo '<your-username>'):$CURRENT_BRANCH"
info "合并到上游分支: upstream/$BASE_BRANCH"

if [ "$INTERACTIVE" = "true" ]; then
  blank
  read -rp "确认创建 PR 吗？[y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y|yes|YES) ;;
    *) info "已取消创建 PR。"; exit 0 ;;
  esac
fi

blank

# 7. 自动推断 GitHub 用户名（从 origin URL 提取）

parse_github_username() {
  case "$ORIGIN_URL" in
    git@github.com:*)
      local tmp="${ORIGIN_URL#git@github.com:}"
      tmp="${tmp%.git}"
      printf '%s\n' "${tmp%%/*}"
      ;;
    https://github.com/*)
      local tmp="${ORIGIN_URL#https://github.com/}"
      tmp="${tmp%.git}"
      printf '%s\n' "${tmp%%/*}"
      ;;
    *)
      printf '%s\n' ""
      ;;
  esac
}

GITHUB_USER="$(parse_github_username)"

if [ -z "$GITHUB_USER" ]; then
  info "无法从 origin URL 中自动解析 GitHub 用户名。"
  info "请在命令中手工指定 --head 参数或调整脚本。"
  exit 1
fi

HEAD_REF="${GITHUB_USER}:${CURRENT_BRANCH}"

info "使用 gh 创建 PR："
info "  base: $BASE_BRANCH"
info "  head: $HEAD_REF"
blank

# 8. 使用 gh 创建 Pull Request（自动处理 default repo）

gh_pr_create_with_default_repo "$BASE_BRANCH" "$HEAD_REF"

blank
info "PR 创建命令已执行。"
info "查看 PR 列表： gh pr list"
info "打开刚才的 PR 页面： gh pr view --web"
