import { createSignal } from "solid-js";
import { useCopyButton } from "./shared";

interface JsonToolProps {
  defaultValue: string;
}

export default function JsonTool(props: JsonToolProps) {
  const [input, setInput] = createSignal(props.defaultValue);
  const [output, setOutput] = createSignal("");
  const [status, setStatus] = createSignal({ message: "等待输入", error: false });
  const copy = useCopyButton(output);

  const format = () => {
    try {
      setOutput(JSON.stringify(JSON.parse(input()), null, 2));
      setStatus({ message: "JSON 已格式化", error: false });
    } catch {
      setStatus({ message: "JSON 解析失败", error: true });
    }
  };

  const minify = () => {
    try {
      setOutput(JSON.stringify(JSON.parse(input())));
      setStatus({ message: "JSON 已压缩", error: false });
    } catch {
      setStatus({ message: "JSON 解析失败", error: true });
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
          <button class="tool-button primary" type="button" onClick={format}>
            格式化
          </button>
          <button class="tool-button" type="button" onClick={minify}>
            压缩
          </button>
          <button class="tool-button" type="button" onClick={copy.onClick}>
            {copy.label()}
          </button>
        </div>
      </div>
    </div>
  );
}
