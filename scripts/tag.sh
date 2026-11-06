#!/usr/bin/env bash
# Create and push a semantic release tag from the community repository main.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bump="patch"
remote="${RELEASE_GIT_REMOTE:-origin}"
overrides=()
override_count=0
usage() { echo "Usage: scripts/tag.sh [--bump patch|minor|major] [--unit-version UNIT=MAJOR.MINOR.PATCH ...] [--remote REMOTE]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; bump="$2"; shift 2 ;;
    --unit-version) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; overrides+=("$2"); override_count=$((override_count + 1)); shift 2 ;;
    --remote) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; remote="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$bump" == patch || "$bump" == minor || "$bump" == major ]] || { echo "Invalid bump '$bump'; expected patch, minor, or major" >&2; exit 2; }
[[ "$remote" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Invalid remote name" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo 'git is required' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required' >&2; exit 1; }
cd "$repo_root"
branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == main ]] || { echo "Must run on main (current: ${branch:-detached})" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo 'Worktree must be clean before tagging' >&2; exit 1; }
git fetch "$remote" main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "$remote/main")" ]] || { echo "Local main must match $remote/main" >&2; exit 1; }

latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | sort -V | tail -n 1 || true)"
if [[ -z "$latest" ]]; then major=0; minor=0; patch=0
else IFS=. read -r major minor patch <<< "${latest#v}"; fi
case "$bump" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
esac
version="${major}.${minor}.${patch}"
new_tag="v${version}"
# Check the requested bump strictly advances its selected component from the
# maximum existing semantic tag (and that lower components reset correctly).
if [[ -n "$latest" ]]; then
  IFS=. read -r old_major old_minor old_patch <<< "${latest#v}"
  case "$bump" in
    major) (( major > old_major )) || { echo 'New major must exceed the maximum tag major' >&2; exit 2; } ;;
    minor) (( major > old_major || (major == old_major && minor > old_minor) )) || { echo 'New minor must exceed the maximum tag minor' >&2; exit 2; } ;;
    patch) [[ "$new_tag" != "$latest" && "$(printf '%s\n%s\n' "$latest" "$new_tag" | sort -V | tail -n 1)" == "$new_tag" ]] || { echo 'New patch must exceed the maximum tag version' >&2; exit 2; } ;;
  esac
fi
if git show-ref --verify --quiet "refs/tags/$new_tag"; then echo "Tag already exists: $new_tag" >&2; exit 1; fi

# Reconcile project-managed JSON version fields listed one per line in
# scripts/version-files.conf (paths are relative to the repository root).
version_files="scripts/version-files.conf"
if [[ -f "$version_files" ]]; then
  while IFS= read -r version_file || [[ -n "$version_file" ]]; do
    [[ -z "$version_file" || "$version_file" == \#* ]] && continue
    [[ "$version_file" != /* && "$version_file" != *..* && -f "$version_file" ]] || { echo "Invalid or missing version file path: $version_file" >&2; exit 2; }
    jq -e 'type == "object" and (.version == null or (.version | type == "string"))' "$version_file" >/dev/null || { echo "Expected JSON object with string .version in $version_file" >&2; exit 2; }
    version_tmp="$(mktemp)"
    jq --arg version "$version" '.version = $version' "$version_file" > "$version_tmp"
    if ! cmp -s "$version_tmp" "$version_file"; then cp "$version_tmp" "$version_file"; git add "$version_file"; fi
    rm -f "$version_tmp"
  done < "$version_files"
fi
if ! git diff --cached --quiet; then
  git commit -m "chore(release): set project version ${version}"
fi

map_file="scripts/artifact-versions.conf"
tmp_map="$(mktemp)"
trap 'rm -f "$tmp_map"' EXIT
[[ ! -f "$map_file" ]] || cp "$map_file" "$tmp_map"
seen_units=" "
while read -r unit unit_version extra || [[ -n "${unit:-}" ]]; do
  [[ -z "${unit:-}" || "$unit" == \#* ]] && continue
  [[ -z "${extra:-}" && "$unit" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && "$unit_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Invalid entry in $map_file" >&2; exit 2; }
  case "$seen_units" in *" $unit "*) echo "Duplicate unit in $map_file: $unit" >&2; exit 2;; esac
  seen_units="$seen_units$unit "
done < "$tmp_map"
seen_overrides=" "
if ((override_count > 0)); then
for override in "${overrides[@]}"; do
  [[ "$override" == *=* ]] || { echo "Invalid --unit-version '$override'; expected UNIT=VERSION" >&2; exit 2; }
  unit="${override%%=*}"; unit_version="${override#*=}"
  [[ "$unit" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "Invalid unit id: $unit" >&2; exit 2; }
  [[ "$unit_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Invalid version: $unit_version" >&2; exit 2; }
  case "$seen_overrides" in *" $unit "*) echo "Duplicate --unit-version for $unit" >&2; exit 2;; esac
  seen_overrides="$seen_overrides$unit "
  awk -v wanted="$unit" '$1 != wanted { print }' "$tmp_map" > "${tmp_map}.next"
  mv "${tmp_map}.next" "$tmp_map"
  printf '%s %s\n' "$unit" "$unit_version" >> "$tmp_map"
done
fi
if ((override_count > 0)); then
  sort -k1,1 "$tmp_map" -o "$tmp_map"
  if [[ ! -f "$map_file" ]] || ! cmp -s "$tmp_map" "$map_file"; then
    cp "$tmp_map" "$map_file"
    git add "$map_file"
    git commit -m "chore(release): set artifact versions for ${version}"
  fi
fi

git tag -a "$new_tag" -m "Release ${new_tag}"
git push "$remote" main "$new_tag"
printf 'Created and pushed %s at %s\n' "$new_tag" "$(git rev-parse HEAD)"
