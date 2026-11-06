#!/usr/bin/env bash
# Build the browser extension ZIP from an already tagged, isolated checkout.
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref="" version="" output_dir=""
usage() { printf 'Usage: %s --ref COMMIT --version MAJOR.MINOR.PATCH --output-dir DIR\n' "$(basename "$0")"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref|--version|--output-dir)
      [[ $# -ge 2 && -n "$2" ]] || { usage >&2; exit 2; }
      case "$1" in --ref) ref="$2";; --version) version="$2";; --output-dir) output_dir="$2";; esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unsupported argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$ref" && -n "$version" && -n "$output_dir" ]] || { usage >&2; exit 2; }
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Invalid version: $version" >&2; exit 2; }
for command_name in git tar zip jq; do command -v "$command_name" >/dev/null 2>&1 || { echo "$command_name is required" >&2; exit 1; }; done
if command -v sha256sum >/dev/null 2>&1; then sha_command=sha256sum
elif command -v shasum >/dev/null 2>&1; then sha_command=shasum
else echo 'sha256sum or shasum is required' >&2; exit 1
fi
commit="$(git -C "$root_dir" rev-parse --verify "${ref}^{commit}")"
[[ "$(git -C "$root_dir" rev-parse HEAD)" == "$commit" ]] || { echo 'Checkout does not match --ref.' >&2; exit 1; }
[[ -z "$(git -C "$root_dir" status --porcelain --untracked-files=all)" ]] || { echo 'Package checkout must be clean.' >&2; exit 1; }
manifest_version="$(jq -r '.version // empty' "$root_dir/manifest.json")"
[[ "$manifest_version" == "$version" ]] || { echo "manifest.json version ($manifest_version) does not match release version ($version)." >&2; exit 1; }
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
[[ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Output directory must be empty.' >&2; exit 1; }
commit_short="${commit:0:7}"
package_root="wallet-v${version}-${commit_short}"
package_name="${package_root}.zip"
stage="$(mktemp -d "${TMPDIR:-/tmp}/wallet-package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/$package_root"
git -C "$root_dir" archive "$commit" | tar -xf - -C "$stage/$package_root"
for build_only in scripts output docs examples .git; do rm -rf "$stage/$package_root/$build_only"; done
(cd "$stage" && zip -qry "$package_name" "$package_root")
if [[ "$sha_command" == sha256sum ]]; then checksum="$(sha256sum "$stage/$package_name" | awk '{print $1}')"
else checksum="$(shasum -a 256 "$stage/$package_name" | awk '{print $1}')"; fi
artifact="$(jq -cnS --arg version "$version" --arg package "$package_name" --arg sha "$checksum" --arg root "$package_root" '{unit_id:"wallet",type:"desktop",version:$version,package:$package,sha256:$sha,package_root:$root}')"
jq -cnS --arg repository wallet --arg source_commit "$commit" --argjson artifact "$artifact" '{schema_version:1,repository:$repository,source_commit:$source_commit,artifacts:[$artifact]}' > "$stage/release-manifest.json"
mv "$stage/$package_name" "$output_dir/$package_name"
mv "$stage/release-manifest.json" "$output_dir/release-manifest.json"
printf 'Created desktop artifact %s for %s at %s\n' "$package_name" "$commit" "$output_dir"
