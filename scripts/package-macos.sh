#!/bin/bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "Usage: $0 <CMake build directory> <Qt directory> [output directory]" >&2
    exit 2
fi

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$(cd "$1" && pwd)"
qt_dir="$(cd "$2" && pwd)"
output_dir="${3:-$project_dir/dist}"
mkdir -p "$output_dir"

app_name="NHIS Checker"
bundle_name="$app_name.app"
version="$(plutil -extract CFBundleShortVersionString raw "$build_dir/$bundle_name/Contents/Info.plist")"
architecture="$(lipo -archs "$build_dir/$bundle_name/Contents/MacOS/$app_name")"
case "$architecture" in
    arm64)  label="Apple Silicon" ;;
    x86_64) label=Intel ;;
    *) echo "Build a single arm64 or x86_64 executable." >&2; exit 2 ;;
esac

stage="$(mktemp -d /tmp/nzis-dmg.XXXXXX)"
pending=
trap 'rm -rf "$stage"; if [[ -n "$pending" ]]; then rm -f "$pending"; fi' EXIT
mkdir "$stage/payload"
bundle="$stage/payload/$bundle_name"
ditto "$build_dir/$bundle_name" "$bundle"
"$qt_dir/bin/macdeployqt" "$bundle" 2>&1 | tee "$stage/deploy.log"
if grep -q '^ERROR:' "$stage/deploy.log"; then
    exit 1
fi

while IFS= read -r -d '' binary; do
    [[ "$(file -b "$binary")" == Mach-O* ]] || continue
    lipo "$binary" -verify_arch "$architecture"
    minimum="$(xcrun vtool -arch "$architecture" -show-build "$binary" |
        awk '$1 == "minos" || $1 == "version" { print $2; exit }')"
    if ! awk -F. 'NF >= 2 && $1 + 0 < 12 { ok = 1 }
        NF >= 2 && $1 + 0 == 12 && $2 + 0 == 0 && $3 + 0 == 0 { ok = 1 }
        END { exit !ok }' <<<"$minimum"; then
        echo "$binary requires macOS ${minimum:-unknown}." >&2
        exit 1
    fi
done < <(find "$bundle/Contents" -type f -print0)

plutil -replace CFBundleDisplayName -string "$app_name" "$bundle/Contents/Info.plist"
plutil -replace LSMinimumSystemVersion -string 12.0 "$bundle/Contents/Info.plist"
cp "$project_dir/LICENSE" "$bundle/Contents/Resources/LICENSE.txt"
codesign --force --deep --sign - "$bundle"
codesign --verify --deep --strict "$bundle"

ln -s /Applications "$stage/payload/Applications"
hdiutil makehybrid -hfs -hfs-volume-name "$app_name ($label)" \
    -o "$stage/raw.dmg" "$stage/payload"
hdiutil convert "$stage/raw.dmg" -format UDZO -o "$stage/installer.dmg"
hdiutil verify -quiet "$stage/installer.dmg"

filename="$app_name $version - $label.dmg"
pending="$(mktemp "$output_dir/.$filename.XXXXXX")"
cp "$stage/installer.dmg" "$pending"
mv -f "$pending" "$output_dir/$filename"
pending=
printf '%s\n' "$output_dir/$filename"
