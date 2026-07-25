import { createSignal } from "solid-js";
import { useCopyButton } from "./shared";

interface UrlToolProps {
  defaultValue: string;
}

export default function UrlTool(props: UrlToolProps) {
  const [input, setInput] = createSignal(props.defaultValue);
  const [output, setOutput] = createSignal("");
  const [status, setStatus] = createSignal({ message: "等待输入", error: false });
  const copy = useCopyButton(output);

  const encode = () => {
    setOutput(encodeURIComponent(input()));
    setStatus({ message: "URL 已编码", error: false });
  };

  const decode = () => {
    try {
      setOutput(decodeURIComponent(input()));
      setStatus({ message: "URL 已解码", error: false });
    } catch {
      setStatus({ message: "URL 解码失败", error: true });
    }
  };

  return (
    <div class="workspace dual-editor">
      <label>
        <span>输入</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
      </label>
      <label>
        <span>输出</span>
        <textarea class="tool-control tool-textarea code-text" readonly value={output()} />
      </label>
      <div class="tool-footer">
        <p class="tool-status" data-state={status().error ? "error" : "ok"}>
          {status().message}
        </p>
        <div class="panel-actions">
          <button class="tool-button primary" type="button" onClick={encode}>
            编码
          </button>
          <button class="tool-button" type="button" onClick={decode}>
            解码
          </button>
          <button class="tool-button" type="button" onClick={copy.onClick}>
            {copy.label()}
          </button>
        </div>
      </div>
    </div>
  );
}
