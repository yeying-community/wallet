#!/usr/bin/env bash
# Create a release-only version commit and publish its annotated tag, never main.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bump=patch
remote="${RELEASE_GIT_REMOTE:-origin}"
overrides=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump) [[ $# -ge 2 ]] || { echo 'Usage: scripts/tag.sh [--bump patch|minor|major] [--unit-version UNIT=VERSION]'; exit 2; }; bump="$2"; shift 2 ;;
    --unit-version) [[ $# -ge 2 ]] || { echo '--unit-version requires UNIT=VERSION' >&2; exit 2; }; overrides+=("$2"); shift 2 ;;
    --remote) [[ $# -ge 2 ]] || { echo '--remote requires REMOTE' >&2; exit 2; }; remote="$2"; shift 2 ;;
    -h|--help) echo 'Usage: scripts/tag.sh [--bump patch|minor|major] [--unit-version UNIT=VERSION] [--remote REMOTE]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$bump" == patch || "$bump" == minor || "$bump" == major ]] || { echo "Invalid bump '$bump'; expected patch, minor, or major" >&2; exit 2; }
[[ "$remote" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo 'Invalid remote name' >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo 'git is required' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required' >&2; exit 1; }
cd "$repo_root"
branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == main ]] || { echo "Must run on main (current: ${branch:-detached})" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Worktree must be clean before tagging' >&2; exit 1; }
git fetch "$remote" main --tags
source_commit="$(git rev-parse HEAD)"
[[ "$source_commit" == "$(git rev-parse "$remote/main")" ]] || { echo "Local main must match $remote/main" >&2; exit 1; }
latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | sort -V | tail -n 1 || true)"
if [[ -z "$latest" ]]; then major=0; minor=0; patch=0; else IFS=. read -r major minor patch <<< "${latest#v}"; fi
case "$bump" in patch) patch=$((patch + 1));; minor) minor=$((minor + 1)); patch=0;; major) major=$((major + 1)); minor=0; patch=0;; esac
version="${major}.${minor}.${patch}"
new_tag="v${version}"
if [[ -n "$latest" ]]; then
  IFS=. read -r old_major old_minor old_patch <<< "${latest#v}"
  case "$bump" in
    major) (( major > old_major )) || { echo 'New major must exceed the maximum tag major' >&2; exit 2; } ;;
    minor) (( major > old_major || (major == old_major && minor > old_minor) )) || { echo 'New minor must exceed the maximum tag minor' >&2; exit 2; } ;;
    patch) [[ "$(printf '%s\n%s\n' "$latest" "$new_tag" | sort -V | tail -n 1)" == "$new_tag" && "$new_tag" != "$latest" ]] || { echo 'New patch must exceed the maximum tag version' >&2; exit 2; } ;;
  esac
fi
git show-ref --verify --quiet "refs/tags/$new_tag" && { echo "Tag already exists: $new_tag" >&2; exit 1; } || true
release_worktree="$(mktemp -d "${TMPDIR:-/tmp}/release-tag-${version}.XXXXXX")"
rmdir "$release_worktree"
cleanup() { git -C "$repo_root" worktree remove --force "$release_worktree" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
git worktree add --detach "$release_worktree" "$source_commit" >/dev/null
cd "$release_worktree"
version_files=scripts/version-files.conf
if [[ -f "$version_files" ]]; then
  while IFS= read -r version_file || [[ -n "$version_file" ]]; do
    [[ -z "$version_file" || "$version_file" == \#* ]] && continue
    [[ "$version_file" != /* && "$version_file" != *..* && -f "$version_file" ]] || { echo "Invalid or missing version file path: $version_file" >&2; exit 2; }
    jq -e 'type == "object" and (.version == null or (.version | type == "string"))' "$version_file" >/dev/null || { echo "Expected JSON object with string .version in $version_file" >&2; exit 2; }
    jq --arg version "$version" '.version = $version' "$version_file" > "${version_file}.tmp"
    mv "${version_file}.tmp" "$version_file"
    git add "$version_file"
  done < "$version_files"
fi
map_file=scripts/artifact-versions.conf
if (( ${#overrides[@]} > 0 )); then
  tmp_map="$(mktemp)"
  [[ ! -f "$map_file" ]] || cp "$map_file" "$tmp_map"
  seen_units=" "
  while read -r map_unit map_version extra || [[ -n "${map_unit:-}" ]]; do
    [[ -z "${map_unit:-}" || "$map_unit" == \#* ]] && continue
    [[ -z "${extra:-}" && "$map_unit" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && "$map_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Invalid entry in $map_file" >&2; exit 2; }
    case "$seen_units" in *" $map_unit "*) echo "Duplicate unit in $map_file: $map_unit" >&2; exit 2;; esac
    seen_units+="$map_unit "
  done < "$tmp_map"
  seen_overrides=" "
  for override in "${overrides[@]}"; do
    [[ "$override" == *=* ]] || { echo "Invalid --unit-version '$override'; expected UNIT=VERSION" >&2; exit 2; }
    unit="${override%%=*}"; unit_version="${override#*=}"
    [[ "$unit" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && "$unit_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Invalid --unit-version '$override'" >&2; exit 2; }
    case "$seen_overrides" in *" $unit "*) echo "Duplicate --unit-version for $unit" >&2; exit 2;; esac
    seen_overrides+="$unit "
    awk -v wanted="$unit" '$1 != wanted {print}' "$tmp_map" > "${tmp_map}.next"
    mv "${tmp_map}.next" "$tmp_map"
    printf '%s %s\n' "$unit" "$unit_version" >> "$tmp_map"
  done
  sort -k1,1 "$tmp_map" -o "$tmp_map"
  mkdir -p "$(dirname "$map_file")"
  cp "$tmp_map" "$map_file"
  rm -f "$tmp_map"
  git add "$map_file"
fi
if ! git diff --cached --quiet; then git commit -m "chore(release): set project version ${version}"; fi
release_commit="$(git rev-parse HEAD)"
git tag -a "$new_tag" -m "Release ${new_tag}" -m "Source-Commit: ${source_commit}"
git push "$remote" "refs/tags/${new_tag}:refs/tags/${new_tag}"
printf 'TAG=%s SOURCE_COMMIT=%s RELEASE_COMMIT=%s\n' "$new_tag" "$source_commit" "$release_commit"
