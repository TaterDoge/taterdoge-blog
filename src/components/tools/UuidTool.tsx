import { createSignal, onMount } from "solid-js";
import { createUuid, clamp, useCopyButton } from "./shared";

export default function UuidTool() {
  const [count, setCount] = createSignal("5");
  const [output, setOutput] = createSignal("");
  const copy = useCopyButton(output);

  const generate = () => {
    const n = clamp(Number.parseInt(count(), 10) || 1, 1, 100);
    setOutput(Array.from({ length: n }, createUuid).join("\n"));
  };

  onMount(generate);

  return (
    <div class="workspace uuid-workspace">
      <div class="uuid-controls">
        <label>
          <span>生成数量</span>
          <input
            class="tool-control code-text"
            inputmode="numeric"
            value={count()}
            onInput={(e) => setCount(e.currentTarget.value)}
          />
        </label>
        <div class="panel-actions">
          <button class="tool-button primary" type="button" onClick={generate}>
            生成 UUID
          </button>
          <button class="tool-button" type="button" onClick={copy.onClick}>
            {copy.label()}
          </button>
        </div>
      </div>
      <label class="wide">
        <span>结果</span>
        <textarea class="tool-control tool-textarea compact code-text" readonly value={output()} />
      </label>
    </div>
  );
}
