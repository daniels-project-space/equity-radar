"use client";

/** Web Push keys travel as URL-safe base64; the API wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export type PushState =
  | "unsupported"
  | "denied"
  | "prompt"
  | "subscribed"
  | "insecure";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function currentState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  // Push requires a secure context; on plain http the APIs exist but fail.
  if (!window.isSecureContext) return "insecure";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "prompt";
}

export async function subscribe(
  vapidPublicKey: string
): Promise<{ endpoint: string; p256dh: string; auth: string } | { error: string }> {
  if (!pushSupported()) return { error: "This browser does not support push notifications." };
  if (!window.isSecureContext) {
    return { error: "Push needs https. Open the deployed site rather than a local http address." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { error: `Permission ${permission}.` };

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? bufferToBase64(sub.getKey("p256dh")),
    auth: json.keys?.auth ?? bufferToBase64(sub.getKey("auth")),
  };
}

export async function unsubscribe(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
