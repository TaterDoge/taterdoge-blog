import { createSignal } from "solid-js";
import { utf8ToBase64, base64ToUtf8, useCopyButton } from "./shared";

interface Base64ToolProps {
  defaultValue: string;
}

export default function Base64Tool(props: Base64ToolProps) {
  const [plain, setPlain] = createSignal(props.defaultValue);
  const [encoded, setEncoded] = createSignal("");
  const [status, setStatus] = createSignal({ message: "等待输入", error: false });
  const copy = useCopyButton(encoded);

  const encode = () => {
    setEncoded(utf8ToBase64(plain()));
    setStatus({ message: "已从左侧明文编码到右侧 Base64", error: false });
  };

  const decode = () => {
    try {
      setPlain(base64ToUtf8(encoded().trim()));
      setStatus({ message: "已从右侧 Base64 解码到左侧明文", error: false });
    } catch {
      setStatus({ message: "Base64 解码失败", error: true });
    }
  };

  return (
    <div class="workspace dual-editor">
      <label>
        <span>明文</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          value={plain()}
          onInput={(e) => setPlain(e.currentTarget.value)}
        />
      </label>
      <label>
        <span>Base64 密文</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          value={encoded()}
          onInput={(e) => setEncoded(e.currentTarget.value)}
        />
      </label>
      <div class="tool-footer">
        <p class="tool-status" data-state={status().error ? "error" : "ok"}>
          {status().message}
        </p>
        <div class="panel-actions">
          <button class="tool-button primary" type="button" onClick={encode}>
            明文 → Base64
          </button>
          <button class="tool-button" type="button" onClick={decode}>
            Base64 → 明文
          </button>
          <button class="tool-button" type="button" onClick={copy.onClick}>
            {copy.label()}
          </button>
        </div>
      </div>
    </div>
  );
}
