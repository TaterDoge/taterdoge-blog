import { createSignal, createMemo, onMount } from "solid-js";

interface TextStatsToolProps {
  defaultValue: string;
}

export default function TextStatsTool(props: TextStatsToolProps) {
  const [text, setText] = createSignal(props.defaultValue);

  const stats = createMemo(() => {
    const t = text();
    const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const words = (t.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
    const lines = t.length ? t.split(/\r\n|\r|\n/).length : 0;
    const minutes = Math.max(1, Math.ceil(cjk / 500 + words / 220 || 0.1));
    return { chars: t.length, cjk, words, lines, minutes };
  });

  return (
    <div class="workspace dual-editor side-result">
      <label>
        <span>文本</span>
        <textarea
          class="tool-control tool-textarea"
          spellcheck="false"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <aside class="stat-board">
        <span>
          字符 <strong>{stats().chars}</strong>
        </span>
        <span>
          中文 <strong>{stats().cjk}</strong>
        </span>
        <span>
          单词 <strong>{stats().words}</strong>
        </span>
        <span>
          段落数 <strong>{stats().lines}</strong>
        </span>
        <span>
          阅读 <strong>{stats().minutes} 分钟</strong>
        </span>
      </aside>
    </div>
  );
}
