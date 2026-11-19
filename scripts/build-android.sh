#!/usr/bin/env bash
# Builds the signed release APK. Needs JDK 17+, the Android SDK and android/keystore.properties.
set -euo pipefail
cd "$(dirname "$0")/../android"
./gradlew --no-daemon --console=plain :app:testDebugUnitTest :app:assembleRelease
echo "APK: android/app/build/outputs/apk/release/app-release.apk"
