#!/usr/bin/env bash
# Builds the signed release APK. Needs JDK 21, the Android SDK and android/keystore.properties.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
npx cap sync android
cd android
JAVA_HOME="${JAVA_HOME_21:-/usr/lib/jvm/java-21-openjdk-amd64}" ./gradlew --no-daemon --console=plain :app:assembleRelease -x lint
echo "APK: android/app/build/outputs/apk/release/app-release.apk"
