#!/usr/bin/env bash
# Generates the native iOS project (ios-app/ios, Capacitor + Swift Package
# Manager) around the bundled web build. macOS only: the GitHub Actions
# workflow (.github/workflows/ios-ipa.yml) runs it; it needs Node 22+.
#
#   pnpm build:native && bash ios-app/scripts/prepare-ios.sh
#
# Everything the app needs is copied into the app bundle (ios/App/App/public):
# nothing is loaded from the network at run time.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)" # ios-app/
root="$(cd "$here/.." && pwd)"
cd "$here"

[ -f "$root/dist-native/index.html" ] || { echo "dist-native/ missing: run 'pnpm build:native' first" >&2; exit 1; }
[ -f assets/AppIcon-1024.png ] && [ -f assets/Splash-2732.png ] || { echo "ios-app/assets missing: run 'pnpm native:assets'" >&2; exit 1; }

rm -rf www ios
cp -R "$root/dist-native" www

npm install --no-audit --no-fund --loglevel=error
npx cap add ios --packagemanager SPM
npx cap sync ios

app=ios/App/App
plist="$app/Info.plist"
set_plist() { plutil -replace "$1" "$2" "$3" "$plist"; } # key, -string/-bool/-json, value

# Home Screen name (the PWA's apple-mobile-web-app-title).
set_plist CFBundleDisplayName -string "GM Lab"

# Portrait only, like the PWA manifest.
set_plist UISupportedInterfaceOrientations -json '["UIInterfaceOrientationPortrait"]'
set_plist 'UISupportedInterfaceOrientations~ipad' -json '["UIInterfaceOrientationPortrait"]'
set_plist UIRequiresFullScreen -bool YES

# Status bar: light text drawn over the app's dark header (the web view runs
# edge to edge; the CSS keeps content clear with env(safe-area-inset-*)).
set_plist UIViewControllerBasedStatusBarAppearance -bool NO
set_plist UIStatusBarStyle -string UIStatusBarStyleLightContent
set_plist UIStatusBarHidden -bool NO
# The app is dark-only (color-scheme: dark): keep native pieces (keyboard, alerts) dark too.
set_plist UIUserInterfaceStyle -string Dark
# Offline app, no custom crypto.
set_plist ITSAppUsesNonExemptEncryption -bool NO

# App icon: one 1024 x 1024 universal image (Xcode renders the other sizes).
icons="$app/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$icons"
rm -f "$icons"/*.png
cp assets/AppIcon-1024.png "$icons/AppIcon-1024.png"
cat > "$icons/Contents.json" <<'JSON'
{
  "images": [{ "filename": "AppIcon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" }],
  "info": { "author": "xcode", "version": 1 }
}
JSON

# Launch screen: Capacitor's storyboard shows the "Splash" image (aspect fill).
splash="$app/Assets.xcassets/Splash.imageset"
if compgen -G "$splash/*.png" >/dev/null; then
  for f in "$splash"/*.png; do cp assets/Splash-2732.png "$f"; done
else
  echo "::warning::Splash.imageset not found in the Capacitor template; launch screen left as generated"
fi
grep -q 'image="Splash"' "$app/Base.lproj/LaunchScreen.storyboard" ||
  echo "::warning::LaunchScreen.storyboard no longer references the Splash image"

plutil -lint "$plist"
echo "--- Info.plist"
plutil -p "$plist"
echo "--- capacitor.config.json in the app"
cat "$app/capacitor.config.json"
