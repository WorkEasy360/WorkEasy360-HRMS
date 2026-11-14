import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * The Android app (mobile/) is a Capacitor shell that loads this site. Inside
 * it the native bridge is present; in a browser it is not, and every helper
 * here falls back to plain web behaviour.
 */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a generated or downloaded file.
 *
 * Browser: the usual download. App: an Android WebView ignores `<a download>`,
 * so the file is written to the app's cache and handed to the share sheet,
 * where the person can open it, save it to Files or send it on.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (isNativeApp()) {
    const safeName = fileName.replace(/[^\w.\- ]+/g, "_");
    const written = await Filesystem.writeFile({
      path: safeName,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title: safeName, files: [written.uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
