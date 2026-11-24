#!/usr/bin/env bash
# Builds the UNSIGNED .ipa from the Xcode project that prepare-ios.sh made,
# then checks what is inside. macOS only; used by both cloud builds
# (codemagic.yaml and .github/workflows/ios-ipa.yml).
#
#   bash ios-app/scripts/build-ipa.sh <build-number>
#
# Output: build/ipa/GrandmasterLab-<version>-<build-number>-unsigned.ipa
# Sideloadly (or AltStore) signs it with your Apple ID when installing.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
build_number="${1:-1}"
version=$(node -p "require('./package.json').version")
derived="$root/build/dd"
out="$root/build/ipa"
name="GrandmasterLab-${version}-${build_number}-unsigned.ipa"

[ -d ios-app/ios/App/App.xcodeproj ] || { echo "no Xcode project: run ios-app/scripts/prepare-ios.sh first" >&2; exit 1; }

echo "--- building App.app (Release, unsigned, iPhone only)"
xcodebuild -version
xcodebuild \
  -project ios-app/ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  TARGETED_DEVICE_FAMILY=1 \
  MARKETING_VERSION="$version" \
  CURRENT_PROJECT_VERSION="$build_number" \
  -quiet \
  build

app="$derived/Build/Products/Release-iphoneos/App.app"
[ -d "$app" ] || { echo "App.app not found at $app" >&2; exit 1; }

echo "--- packaging $name"
rm -rf "$out"
mkdir -p "$out/Payload"
cp -R "$app" "$out/Payload/"
(cd "$out" && zip -qry "$name" Payload && rm -rf Payload)

echo "--- checking the .ipa"
check=$(mktemp -d)
unzip -q "$out/$name" -d "$check"
a="$check/Payload/App.app"
ls -l "$out/$name"
du -sh "$a"
plutil -p "$a/Info.plist"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$a/Info.plist")
[ "$bundle_id" = com.grandmasterlab.app ] || { echo "unexpected bundle id: $bundle_id" >&2; exit 1; }
for f in index.html \
  engines/patricia/patricia-st.js engines/patricia/patricia-st.wasm engines/patricia/patricia-nets.bin \
  engines/stockfish/stockfish-19-lite-single.js engines/stockfish/stockfish-19-lite-single.wasm \
  books/The-Grandmaster-Files.bin books/eco.json; do
  [ -s "$a/public/$f" ] || { echo "missing public/$f" >&2; exit 1; }
  echo "ok public/$f"
done
[ ! -e "$a/public/sw.js" ] || { echo "service worker must not be bundled" >&2; exit 1; }
echo "--- capacitor.config.json (must have no server.url: everything is offline)"
cat "$a/capacitor.config.json"
if grep -q '"url"' "$a/capacitor.config.json"; then echo "server.url is set" >&2; exit 1; fi
echo "--- signing (expected: none)"
ls "$a" | grep -E '_CodeSignature|embedded.mobileprovision' || echo "unsigned: ok"
echo "--- frameworks"
ls "$a/Frameworks" 2>/dev/null || echo "(none)"
rm -rf "$check"
echo "IPA ready: build/ipa/$name"
