/** Shared helpers for SolidJS tool components, ported from the original tools.astro script block. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bytesToHex(bytes: Iterable<number>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
  );
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function base64UrlToJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requireSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle)
    throw new Error("当前地址不支持 Web Crypto，请用 localhost 或 HTTPS 打开后再计算。");
  return globalThis.crypto.subtle;
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to the textarea copy path below.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** A reusable "copy" button: copies `getValue()` and shows feedback. */
import { createSignal } from "solid-js";

export function useCopyButton(getValue: () => string) {
  const [label, setLabel] = createSignal("复制");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onClick = async () => {
    const value = getValue();
    if (!value) return;
    const copied = await copyText(value);
    setLabel(copied ? "已复制" : "复制失败");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setLabel("复制"), 1200);
  };
  return { label, onClick };
}
