import { createSignal, onMount } from "solid-js";

const formatDateTimeLocal = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const formatHumanTime = (date: Date): string =>
  date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export default function TimestampTool() {
  const [tsInput, setTsInput] = createSignal("1767225600");
  const [dateInput, setDateInput] = createSignal("");
  const [output, setOutput] = createSignal("等待转换");
  const [error, setError] = createSignal(false);

  const renderResult = (date: Date, source = "") => {
    const milliseconds = date.getTime();
    const seconds = Math.floor(milliseconds / 1000);
    setDateInput(formatDateTimeLocal(date));
    setOutput(
      `${source ? `${source}\n` : ""}本地时间：${formatHumanTime(date)}\n短时间戳（秒）：${seconds}\n长时间戳（毫秒）：${milliseconds}`,
    );
    setError(false);
  };

  const timestampToDate = () => {
    const raw = Number(tsInput().trim());
    if (!Number.isFinite(raw)) {
      setOutput("请输入有效时间戳");
      setError(true);
      return;
    }
    const isMilliseconds = Math.abs(raw) >= 100000000000;
    renderResult(
      new Date(isMilliseconds ? raw : raw * 1000),
      isMilliseconds ? "识别为长时间戳（毫秒）" : "识别为短时间戳（秒）",
    );
  };

  const dateToTimestamp = () => {
    const value = dateInput().trim();
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      setOutput("请输入有效本地时间");
      setError(true);
      return;
    }
    setTsInput(String(Math.floor(date.getTime() / 1000)));
    renderResult(date, "已从本地时间转换");
  };

  const now = () => {
    const now = new Date();
    setTsInput(String(Math.floor(now.getTime() / 1000)));
    renderResult(now, "当前时间");
  };

  onMount(() => {
    renderResult(new Date(Number(tsInput()) * 1000), "默认示例");
  });

  return (
    <div class="workspace timestamp-workspace">
      <div class="timestamp-card">
        <div class="timestamp-card-head">
          <strong>时间戳转时间</strong>
          <span>自动识别秒级 / 毫秒级</span>
        </div>
        <label>
          <span>时间戳</span>
          <input
            class="tool-control code-text"
            inputmode="numeric"
            value={tsInput()}
            onInput={(e) => setTsInput(e.currentTarget.value)}
          />
        </label>
        <div class="panel-actions">
          <button class="tool-button primary" type="button" onClick={timestampToDate}>
            转换为本地时间
          </button>
        </div>
      </div>

      <div class="timestamp-card">
        <div class="timestamp-card-head">
          <strong>时间转时间戳</strong>
          <span>输出秒级和毫秒级</span>
        </div>
        <label>
          <span>本地时间</span>
          <input
            class="tool-control code-text"
            type="datetime-local"
            step="1"
            value={dateInput()}
            onInput={(e) => setDateInput(e.currentTarget.value)}
          />
        </label>
        <div class="panel-actions">
          <button class="tool-button primary" type="button" onClick={dateToTimestamp}>
            生成时间戳
          </button>
          <button class="tool-button" type="button" onClick={now}>
            填入当前时间
          </button>
        </div>
      </div>

      <output class="tool-result timestamp-result" data-state={error() ? "error" : "ok"}>
        {output()}
      </output>
    </div>
  );
}
