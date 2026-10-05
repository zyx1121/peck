#!/usr/bin/env bash
# Sign, notarize, and attach the macOS app to a GitHub release.
#
# Release Please creates the release when its pull request merges, and main CI
# builds the unsigned app from that commit. Run this on a Mac whose keychain
# holds the Developer ID Application identity and a notarytool profile
# (xcrun notarytool store-credentials):
#
#   scripts/release-mac.sh v0.1.0
set -euo pipefail

tag=${1:?usage: scripts/release-mac.sh <tag>}
repo=zyx1121/peck
identity=${PECK_SIGN_IDENTITY:-Developer ID Application: YongXiang Zhan (68PK3GTMDD)}
profile=${PECK_NOTARY_PROFILE:-zyx-notary}
entitlements="$(cd "$(dirname "$0")" && pwd)/entitlements.mac.plist"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The unsigned app main CI built from the release commit.
sha=$(gh api "repos/$repo/commits/$tag" --jq .sha)
run=$(gh run list --repo "$repo" --workflow ci.yml --commit "$sha" \
  --status success --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -z "$run" ]; then
  echo "No successful CI run for $tag ($sha) yet." >&2
  exit 1
fi
gh run download "$run" --repo "$repo" --name Peck-macos-arm64 --dir "$work"
ditto -x -k "$work/Peck-macos-arm64.zip" "$work/app"
app="$work/app/Peck.app"

sign() {
  codesign --force --timestamp --options runtime --sign "$identity" "$@"
}
# Inside out: every Mach-O file, then frameworks, then helpers, then Peck.
while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q '^Mach-O'; then sign "$file"; fi
done < <(find "$app/Contents" -type f -print0)
for framework in "$app"/Contents/Frameworks/*.framework; do sign "$framework"; done
for helper in "$app"/Contents/Frameworks/*.app; do
  sign --entitlements "$entitlements" "$helper"
done
sign --entitlements "$entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

# Apple checks the signed app, then the ticket is stapled to it so Gatekeeper
# accepts it offline.
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/notarize.zip"
result=$(xcrun notarytool submit "$work/notarize.zip" \
  --keychain-profile "$profile" --wait --output-format json)
status=$(plutil -extract status raw -o - - <<<"$result")
if [ "$status" != "Accepted" ]; then
  id=$(plutil -extract id raw -o - - <<<"$result")
  xcrun notarytool log "$id" --keychain-profile "$profile" >&2
  echo "Notarization finished with status $status." >&2
  exit 1
fi
xcrun stapler staple "$app"
spctl --assess --type execute --verbose=2 "$app"

zip="$work/Peck-macos-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
(cd "$work" && shasum -a 256 Peck-macos-arm64.zip >Peck-macos-arm64.zip.sha256)
gh release upload "$tag" "$zip" "$zip.sha256" --repo "$repo" --clobber
echo "Attached the signed app to $tag."
