#!/usr/bin/env bash
# Sign, notarize, and attach the macOS app to a GitHub release.
#
# Release Please creates the release when its pull request merges, and main CI
# builds the unsigned app from that commit. Run this on a Mac whose keychain
# holds the Developer ID Application identity and a notarytool profile
# (xcrun notarytool store-credentials), with the Developer ID provisioning
# profile for tw.zyx.peck, which allows the passkey keychain group:
#
#   scripts/release-mac.sh v0.1.0
set -euo pipefail

tag=${1:?usage: scripts/release-mac.sh <tag>}
repo=zyx1121/peck
identity=${PECK_SIGN_IDENTITY:-Developer ID Application: YongXiang Zhan (68PK3GTMDD)}
profile=${PECK_NOTARY_PROFILE:-zyx-notary}
profile_file=${PECK_PROVISIONING_PROFILE:-$HOME/Library/MobileDevice/Provisioning Profiles/Peck_Developer_ID.provisionprofile}
scripts="$(cd "$(dirname "$0")" && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A profile that does not allow the app's entitlements makes macOS kill the
# signed app at launch, so check it before signing anything.
if ! security cms -D -i "$profile_file" >"$work/profile.plist" 2>/dev/null; then
  echo "Cannot read a provisioning profile at $profile_file." >&2
  exit 1
fi
python3 - "$work/profile.plist" <<'PY'
import datetime, plistlib, sys

with open(sys.argv[1], "rb") as f:
    profile = plistlib.load(f)
entitlements = profile.get("Entitlements", {})
problems = []
if entitlements.get("com.apple.application-identifier") != "68PK3GTMDD.tw.zyx.peck":
    problems.append("its application identifier is not 68PK3GTMDD.tw.zyx.peck")
now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
if profile.get("ExpirationDate", now) <= now:
    problems.append("it has expired")
if "ProvisionedDevices" in profile:
    problems.append("it lists devices, so it is not a Developer ID profile")
groups = entitlements.get("keychain-access-groups", [])
if not {"68PK3GTMDD.*", "68PK3GTMDD.tw.zyx.peck.webauthn"} & set(groups):
    problems.append("its keychain groups do not cover 68PK3GTMDD.tw.zyx.peck.webauthn")
if problems:
    sys.exit("The provisioning profile cannot be used: " + "; ".join(problems) + ".")
print(f"Provisioning profile valid until {profile['ExpirationDate']:%Y-%m-%d} (UTC).")
PY

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
cp "$profile_file" "$app/Contents/embedded.provisionprofile"

sign() {
  codesign --force --timestamp --options runtime --sign "$identity" "$@"
}
# Inside out: every Mach-O file, then frameworks, then helpers, then Peck.
while IFS= read -r -d '' file; do
  if file -b "$file" | grep -q '^Mach-O'; then sign "$file"; fi
done < <(find "$app/Contents" -type f -print0)
for framework in "$app"/Contents/Frameworks/*.framework; do sign "$framework"; done
for helper in "$app"/Contents/Frameworks/*.app; do
  sign --entitlements "$scripts/entitlements.mac.plist" "$helper"
done
sign --entitlements "$scripts/entitlements.app.mac.plist" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
# codesign and spctl do not evaluate the profile; launching does. Start the
# signed binary once, as Node.js, before Apple sees it, for at most 30 s.
if ! ELECTRON_RUN_AS_NODE=1 perl -e 'alarm 30; exec @ARGV' \
  "$app/Contents/MacOS/Peck" -e 0; then
  echo "macOS refused to launch the signed app. Check the provisioning profile." >&2
  exit 1
fi

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
