import { createSignal } from "solid-js";

interface RegexToolProps {
  defaultValue: string;
  siteName: string;
}

export default function RegexTool(props: RegexToolProps) {
  const [pattern, setPattern] = createSignal("\\b\\w+\\b");
  const [flags, setFlags] = createSignal("g");
  const [text, setText] = createSignal(props.defaultValue);
  const [output, setOutput] = createSignal("等待测试");
  const [error, setError] = createSignal(false);

  const run = () => {
    try {
      const flagsRaw = flags();
      const f = flagsRaw.includes("g") ? flagsRaw : `${flagsRaw}g`;
      const regexp = new RegExp(pattern(), f);
      const matches = Array.from(text().matchAll(regexp));
      setOutput(
        `匹配 ${matches.length} 项：${matches.slice(0, 10).map((m) => m[0]).join(" / ") || "无"}`,
      );
      setError(false);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : "正则表达式错误");
      setError(true);
    }
  };

  return (
    <div class="workspace regex-grid">
      <label>
        <span>表达式</span>
        <input
          class="tool-control code-text"
          value={pattern()}
          onInput={(e) => setPattern(e.currentTarget.value)}
        />
      </label>
      <label>
        <span>Flags</span>
        <input
          class="tool-control code-text"
          value={flags()}
          onInput={(e) => setFlags(e.currentTarget.value)}
        />
      </label>
      <textarea
        class="tool-control tool-textarea compact code-text wide"
        spellcheck="false"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <output class="tool-result wide" data-state={error() ? "error" : "ok"}>
        {output()}
      </output>
      <div class="panel-actions wide">
        <button class="tool-button primary" type="button" onClick={run}>
          测试
        </button>
      </div>
    </div>
  );
}
