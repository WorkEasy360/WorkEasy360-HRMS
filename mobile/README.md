# WorkEasy360 HRMS for Android

An Android app (APK) for WorkEasy360 HRMS, built with [Capacitor](https://capacitorjs.com).
The app is a native shell that opens the live web app at
`https://52-66-103-213.sslip.io`, so:

- **Web changes need no new APK.** Deploy the web app as usual; every installed
  app shows the change the next time it opens.
- **Rebuild the APK only** when something in `mobile/` changes: the app name,
  icon, splash screen, server address, or a Capacitor upgrade.

The phone screens themselves (welcome, home, attendance, employees, payslip,
the green app bar and bottom navigation) live in the web app, under
`frontend/src/components/phone/` and the phone branches of the pages. They also
serve phone browsers.

## What's in here

| Path | What it is |
|---|---|
| `capacitor.config.json` | App id `com.workeasy360.hrms`, name, the live URL, the offline page |
| `www/offline.html` | Shown when the phone has no connection |
| `android/` | The Android project. Icons and splash were generated from `frontend/src/ui/assets/logo.png` |
| `../.github/workflows/android.yml` | Builds and signs the APK on GitHub |

Downloads inside the app (payslip PDF, documents, CSV) open the Android share
sheet, because a WebView can't save `<a download>` links. See
`frontend/src/lib/native.ts`.

## Signing key — set up once

Android only installs an **update** if it is signed with the same key as the
installed app. The key was generated on the maintainer's PC (outside the
repository) and must be kept safe:

- `C:\Users\97920\WorkEasy360-android-signing\workeasy360-release.p12`
- `C:\Users\97920\WorkEasy360-android-signing\GITHUB-SECRETS.txt` (password, alias, and the key as base64)

Back both up somewhere other than this PC. **If the key is lost, installed apps
can't be updated** — everyone would have to uninstall and install again.

Add three repository secrets in GitHub (**Settings → Secrets and variables →
Actions → New repository secret**), copying the values from `GITHUB-SECRETS.txt`:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the long base64 line |
| `ANDROID_KEYSTORE_PASSWORD` | the password |
| `ANDROID_KEY_ALIAS` | `workeasy360` |

Without them the workflow stops with an error rather than ship an APK signed
with a different key.

## Building the APK

1. GitHub → **Actions** → **Android APK** → **Run workflow** (branch `main`).
   Tick *Also publish it as a GitHub Release* to get a public download link.
2. When it finishes (about 5–8 minutes), open the run and download the
   **WorkEasy360-HRMS-1.0.N** artifact (a zip containing the `.apk`), or the
   APK from the release.

Each build gets version `1.0.<run number>`, so a newer APK installs over an
older one.

## Installing on a phone

1. Send the `.apk` to the phone (WhatsApp, email, Drive, USB) and tap it.
2. Android asks to allow installs from that app ("Install unknown apps") — allow it once.
3. Tap **Install**. Play Protect may warn that the app is from an unknown
   developer; choose **Install anyway**. (This goes away only with a Play Store listing.)

## Building locally (optional)

Needs Node 22, JDK 21 and the Android SDK (Android Studio installs both).

```sh
cd mobile
npm ci
npx cap sync android
npx cap open android   # build from Android Studio, or:
cd android && ./gradlew assembleDebug
```

## Not included yet

- **Push notifications** — need a Firebase project (`google-services.json`
  plus a server key). The app and server have no push code yet.
- **Play Store** — needs a Google Play developer account and a store listing;
  the same signing key can be used.
