#!/bin/bash
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$repository/macos/WidgitronWidgets.xcodeproj"
source_dir="$repository/macos/WidgitronWidgets"
build_dir="$repository/macos/.build"
app="${1:-$repository/src-tauri/target/release/bundle/macos/Widgitron.app}"

if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  printf 'Full Xcode is required. Install it, open it once to finish setup, then select it with xcode-select.\n' >&2
  exit 1
fi
if ! xcodebuild -license check >/dev/null 2>&1; then
  printf 'Xcode is installed, but its license is not accepted. Open Xcode and complete its first-run agreement before building.\n' >&2
  exit 1
fi

identity="${WIDGITRON_SIGN_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  identity="$(security find-identity -v -p codesigning | awk -F '"' '/Apple Development:/ {print $2; exit}')"
fi

team_id="${WIDGITRON_TEAM_ID:-}"
if [[ -z "$team_id" && -n "$identity" && "$identity" != "-" ]]; then
  team_id="$(security find-certificate -c "$identity" -p | openssl x509 -noout -subject -nameopt sep_multiline | awk -F= '/^[[:space:]]*OU=/{print $2; exit}')"
fi
if [[ -n "$team_id" && ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  printf 'Invalid Apple Team ID: %s\n' "$team_id" >&2
  exit 1
fi

group_id="${WIDGITRON_APP_GROUP_ID:-}"
if [[ -z "$group_id" && -n "$team_id" ]]; then
  group_id="$team_id.com.evan.widgitron"
fi
group_id="${group_id:-group.com.evan.widgitron}"
if [[ ! "$group_id" =~ ^[A-Za-z0-9.-]+$ ]]; then
  printf 'Invalid app group identifier: %s\n' "$group_id" >&2
  exit 1
fi
export WIDGITRON_APP_GROUP_ID="$group_id"

if [[ $# -eq 0 ]]; then
  (cd "$repository" && pnpm tauri build --bundles app)
fi
if [[ ! -d "$app" ]]; then
  printf 'App bundle missing: %s\n' "$app" >&2
  exit 1
fi

mkdir -p "$build_dir"
xcodebuild \
  -quiet \
  -project "$project" \
  -target WidgitronWidgets \
  -configuration Release \
  -sdk macosx \
  "CONFIGURATION_BUILD_DIR=$build_dir" \
  "WIDGITRON_APP_GROUP_ID=$group_id" \
  CODE_SIGNING_ALLOWED=NO \
  build

built_extension="$build_dir/WidgitronWidgets.appex"
extension="$app/Contents/PlugIns/WidgitronWidgets.appex"
if [[ ! -d "$built_extension" ]]; then
  printf 'Xcode did not produce %s\n' "$built_extension" >&2
  exit 1
fi
mkdir -p "$app/Contents/PlugIns"
rm -rf "$extension"
ditto "$built_extension" "$extension"

bridge="$app/Contents/Frameworks/libWidgitronWidgetBridge.dylib"
mkdir -p "$app/Contents/Frameworks"
xcrun swiftc -O -emit-library -module-name WidgitronWidgetBridge \
  "$repository/macos/WidgitronWidgetBridge.swift" -o "$bridge"

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
cp "$source_dir/Host.entitlements" "$temporary/Host.entitlements"
cp "$source_dir/Widget.entitlements" "$temporary/Widget.entitlements"
/usr/libexec/PlistBuddy -c "Set :com.apple.security.application-groups:0 $group_id" "$temporary/Host.entitlements"
/usr/libexec/PlistBuddy -c "Set :com.apple.security.application-groups:0 $group_id" "$temporary/Widget.entitlements"

if [[ -z "$identity" || "$identity" == "-" ]]; then
  identity="-"
  printf 'Building for inspection with an ad-hoc signature; WidgetKit availability is unverified.\n' >&2
fi
codesign --force --sign "$identity" --entitlements "$temporary/Widget.entitlements" "$extension"
codesign --force --sign "$identity" "$bridge"
codesign --force --sign "$identity" --entitlements "$temporary/Host.entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

printf 'Built Xcode Widget Extension in %s\n' "$app"
printf 'Signing identity: %s\nApp Group: %s\n' "$identity" "$group_id"
