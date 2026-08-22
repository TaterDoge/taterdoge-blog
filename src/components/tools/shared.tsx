/** Shared helpers for SolidJS tool components, ported from the original tools.astro script block. */
import { createSignal, For } from "solid-js";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bytesToHex(bytes: Iterable<number>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
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

function base64UrlToBytes(value: string): Uint8Array {
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
  for (let index = 0; index < length; index += 1)
    bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createUuid(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function")
    return webCrypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requireSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "当前地址不支持 Web Crypto，请用 localhost 或 HTTPS 打开后再计算。",
    );
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

/* ---- 双栏工具骨架：左侧输入、右侧输出、状态栏、动作按钮、复制按钮 ---- */

export type ToolRunResult = {
  output?: string;
  input?: string;
  message: string;
  error?: boolean;
};

export type ToolAction = {
  label: string;
  primary?: boolean;
  run: (ctx: {
    input: string;
    output: string;
    setInput: (value: string) => void;
    setOutput: (value: string) => void;
  }) => ToolRunResult;
};

export function DualEditorTool(props: {
  defaultValue: string;
  inputLabel: string;
  outputLabel: string;
  outputDefault?: string;
  outputEditable?: boolean;
  actions: ToolAction[];
}) {
  const [input, setInput] = createSignal(props.defaultValue);
  const [output, setOutput] = createSignal(props.outputDefault ?? "");
  const [status, setStatus] = createSignal({
    message: "等待输入",
    error: false,
  });
  const copy = useCopyButton(output);

  const runAction = (action: ToolAction) => {
    const result = action.run({
      input: input(),
      output: output(),
      setInput,
      setOutput,
    });
    if (result.output !== undefined) setOutput(result.output);
    if (result.input !== undefined) setInput(result.input);
    setStatus({ message: result.message, error: result.error ?? false });
  };

  return (
    <div class="workspace dual-editor">
      <label>
        <span>{props.inputLabel}</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
      </label>
      <label>
        <span>{props.outputLabel}</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          readonly={!props.outputEditable}
          value={output()}
          onInput={(e) => setOutput(e.currentTarget.value)}
        />
      </label>
      <div class="tool-footer">
        <p class="tool-status" data-state={status().error ? "error" : "ok"}>
          {status().message}
        </p>
        <div class="panel-actions">
          <For each={props.actions}>
            {(action) => (
              <button
                class={`tool-button${action.primary ? " primary" : ""}`}
                type="button"
                onClick={() => runAction(action)}
              >
                {action.label}
              </button>
            )}
          </For>
          <button class="tool-button" type="button" onClick={copy.onClick}>
            {copy.label()}
          </button>
        </div>
      </div>
    </div>
  );
}
