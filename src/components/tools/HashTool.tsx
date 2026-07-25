import { createSignal } from "solid-js";
import { bytesToHex, requireSubtleCrypto, useCopyButton } from "./shared";

interface HashToolProps {
  defaultValue: string;
}

export default function HashTool(props: HashToolProps) {
  const [input, setInput] = createSignal(props.defaultValue);
  const [output, setOutput] = createSignal("等待计算");
  const [error, setError] = createSignal(false);
  const copy = useCopyButton(output);

  const run = async () => {
    try {
      const buffer = await requireSubtleCrypto().digest(
        "SHA-256",
        new TextEncoder().encode(input()),
      );
      setOutput(bytesToHex(new Uint8Array(buffer)));
      setError(false);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "SHA-256 计算失败");
      setError(true);
    }
  };

  return (
    <div class="workspace hash-workspace">
      <label>
        <span>输入</span>
        <textarea
          class="tool-control tool-textarea code-text"
          spellcheck="false"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
        />
      </label>
      <div class="panel-actions">
        <button class="tool-button primary" type="button" onClick={run}>
          计算 SHA-256
        </button>
        <button class="tool-button" type="button" onClick={copy.onClick}>
          {copy.label()}
        </button>
      </div>
      <output class="tool-result hash-output" data-state={error() ? "error" : "ok"}>
        {output()}
      </output>
    </div>
  );
}
