import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import JsonTool from "./JsonTool";
import TimestampTool from "./TimestampTool";
import Base64Tool from "./Base64Tool";
import UrlTool from "./UrlTool";
import UuidTool from "./UuidTool";
import HashTool from "./HashTool";
import TextStatsTool from "./TextStatsTool";
import RegexTool from "./RegexTool";
import ColorsTool from "./ColorsTool";
import JwtTool from "./JwtTool";
import CodeFormatterTool from "./CodeFormatterTool";
import QrCodeTool from "./QrCodeTool";
import CronParserTool from "./CronParserTool";
import ImageConvertTool from "./ImageConvertTool";
import Base64ImageTool from "./Base64ImageTool";
import ColorConverterTool from "./ColorConverterTool";
import DiffTool from "./DiffTool";

export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  status?: string;
}

interface ToolsWorkbenchProps {
  tools: ToolMeta[];
  categories: string[];
  readyCount: number;
  siteName: string;
}

/** Complex tool IDs handled by batch 2 */
const COMPLEX_TOOLS = new Set([
  "jwt-decoder",
  "code-formatter",
  "qrcode-generator",
  "cron-parser",
  "image-convert",
  "base64-image",
  "color-converter",
  "diff-tool",
  "prompts",
]);

/** PascalCase Lucide name → iconify utility (literal strings keep Tailwind scan happy). */
const TOOL_ICON_CLASS: Record<string, string> = {
  Braces: "icon-[lucide--braces]",
  Clock3: "icon-[lucide--clock-3]",
  Binary: "icon-[lucide--binary]",
  Link: "icon-[lucide--link]",
  Fingerprint: "icon-[lucide--fingerprint]",
  Hash: "icon-[lucide--hash]",
  KeyRound: "icon-[lucide--key-round]",
  Pilcrow: "icon-[lucide--pilcrow]",
  Regex: "icon-[lucide--regex]",
  Palette: "icon-[lucide--palette]",
  Code2: "icon-[lucide--code-2]",
  QrCode: "icon-[lucide--qr-code]",
  Sparkles: "icon-[lucide--sparkles]",
  Clock: "icon-[lucide--clock]",
  Image: "icon-[lucide--image]",
  FileImage: "icon-[lucide--file-image]",
  GitCompare: "icon-[lucide--git-compare]",
};

function toolIconClass(name: string): string {
  return TOOL_ICON_CLASS[name] ?? "icon-[lucide--wrench]";
}

function toolHead(icon: string, title: string, desc: string) {
  return (
    <div class="tool-panel-head mb-4 grid grid-cols-[38px_minmax(0,1fr)] items-start gap-3 border-b border-border-soft pb-3.5">
      <span>
        <span class={`${toolIconClass(icon)} size-5 text-current`} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  );
}

export default function ToolsWorkbench(props: ToolsWorkbenchProps) {
  const [activeTool, setActiveTool] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeFilter, setActiveFilter] = createSignal("all");

  const filteredTools = createMemo(() => {
    const keyword = searchQuery().trim().toLowerCase();
    return props.tools.filter((tool) => {
      const matchCategory =
        activeFilter() === "all" || tool.category === activeFilter();
      const matchSearch =
        !keyword ||
        `${tool.name} ${tool.description} ${tool.category}`
          .toLowerCase()
          .includes(keyword);
      return matchCategory && matchSearch;
    });
  });

  const openTool = (id: string, shouldPushHash = true) => {
    const exists = props.tools.some((t) => t.id === id);
    const targetId = exists ? id : "json";
    setActiveTool(targetId);
    if (shouldPushHash) history.replaceState(null, "", `#${targetId}`);
  };

  const onCardClick = (event: MouseEvent, id: string) => {
    event.preventDefault();
    openTool(id);
    requestAnimationFrame(() => {
      const title = document.querySelector(".sidebar-head h2");
      const header = document.querySelector("[data-site-header]");
      if (!(title instanceof HTMLElement)) return;
      const headerHeight =
        header instanceof HTMLElement ? header.offsetHeight : 0;
      const targetTop =
        title.getBoundingClientRect().top + window.scrollY - headerHeight - 10;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    });
  };

  onMount(() => {
    const hashId = decodeURIComponent(location.hash.replace("#", ""));
    if (hashId && props.tools.some((t) => t.id === hashId))
      openTool(hashId, false);
    else openTool(props.tools[0]?.id ?? "json", false);
  });

  const renderPanel = (tool: ToolMeta) => {
    const isActive = () => activeTool() === tool.id;
    return (
      <article
        id={tool.id}
        class="tool-panel"
        classList={{ "is-active": isActive() }}
        aria-hidden={!isActive()}
        inert={!isActive()}
      >
        <Show when={isActive()}>
          <Show
            when={!COMPLEX_TOOLS.has(tool.id)}
            fallback={renderComplexTool(tool)}
          >
            {renderSimpleTool(tool)}
          </Show>
        </Show>
      </article>
    );
  };

  const renderComplexTool = (tool: ToolMeta) => {
    switch (tool.id) {
      case "jwt-decoder":
        return (
          <>
            {toolHead(
              tool.icon,
              "JWT 解码器",
              "解码 Header、Payload，支持 HS256/HS384/HS512 密钥验证。",
            )}
            <JwtTool />
          </>
        );
      case "code-formatter":
        return (
          <>
            {toolHead(
              tool.icon,
              "代码美化格式化",
              "JavaScript / TypeScript / JSON / YAML / SQL 格式化。",
            )}
            <CodeFormatterTool />
          </>
        );
      case "qrcode-generator":
        return (
          <>
            {toolHead(
              tool.icon,
              "二维码生成器",
              "支持单个或按行批量生成二维码。",
            )}
            <QrCodeTool />
          </>
        );
      case "cron-parser":
        return (
          <>
            {toolHead(
              tool.icon,
              "Crontab 表达式解析",
              "解析五段式 cron，显示最近几次本地执行时间。",
            )}
            <CronParserTool />
          </>
        );
      case "image-convert":
        return (
          <>
            {toolHead(
              tool.icon,
              "图片格式转换",
              "PNG / WebP / JPG 互转，支持质量压缩和 Base64 导出。",
            )}
            <ImageConvertTool />
          </>
        );
      case "base64-image":
        return (
          <>
            {toolHead(
              tool.icon,
              "Base64 图片转换",
              "图片转 Base64，也可以把 Data URL 还原为图片预览和下载。",
            )}
            <Base64ImageTool />
          </>
        );
      case "color-converter":
        return (
          <>
            {toolHead(tool.icon, "颜色转换器", "HEX、RGB、HSL 实时转换。")}
            <ColorConverterTool />
          </>
        );
      case "diff-tool":
        return (
          <>
            {toolHead(
              tool.icon,
              "Diff 对比工具",
              "按行对比两段文本并高亮新增、删除和未变内容。",
            )}
            <DiffTool />
          </>
        );
      case "prompts":
        return (
          <>
            {toolHead(tool.icon, "Prompt 抽屉", "常用提示词先占个抽屉位。")}
            <div class="grid place-items-center py-20 text-muted">
              <p>Prompt 抽屉功能开发中</p>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const renderSimpleTool = (tool: ToolMeta) => {
    switch (tool.id) {
      case "json":
        return (
          <>
            {toolHead(
              tool.icon,
              "JSON 格式化",
              "格式化、压缩、复制，错误会显示在状态栏。",
            )}
            <JsonTool
              defaultValue={JSON.stringify({
                name: props.siteName,
                tools: ["format", "diff", "qr"],
              })}
            />
          </>
        );
      case "timestamp":
        return (
          <>
            {toolHead(
              tool.icon,
              "时间戳转换",
              "支持 10 位秒级短时间戳、13 位毫秒级长时间戳和本地时间双向转换。",
            )}
            <TimestampTool />
          </>
        );
      case "base64":
        return (
          <>
            {toolHead(
              tool.icon,
              "Base64 编解码",
              "文本在本地浏览器内编码和解码，支持中文。",
            )}
            <Base64Tool defaultValue={props.siteName} />
          </>
        );
      case "url":
        return (
          <>
            {toolHead(
              tool.icon,
              "URL 编解码",
              "适合处理链接、query 参数和中文路径。",
            )}
            <UrlTool defaultValue="https://marchen.dev/search?q=个人站&tag=工具" />
          </>
        );
      case "uuid":
        return (
          <>
            {toolHead(tool.icon, "UUID 生成", "一次生成多条随机 UUID。")}
            <UuidTool />
          </>
        );
      case "hash":
        return (
          <>
            {toolHead(tool.icon, "SHA-256 摘要", "在浏览器本地计算文本摘要。")}
            <HashTool defaultValue={props.siteName} />
          </>
        );
      case "text-stats":
        return (
          <>
            {toolHead(
              tool.icon,
              "文本统计",
              "字符、中文、英文单词、段落数和阅读时间实时统计。",
            )}
            <TextStatsTool defaultValue="把一段文字贴进来，看看它大概需要读多久" />
          </>
        );
      case "regex":
        return (
          <>
            {toolHead(tool.icon, "正则测试", "测试表达式、flags 和匹配片段。")}
            <RegexTool
              defaultValue={`${props.siteName} writes code and notes.`}
              siteName={props.siteName}
            />
          </>
        );
      case "colors":
        return (
          <>
            {toolHead(tool.icon, "颜色速查", "当前页面核心色彩 token。")}
            <ColorsTool />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div class="tools-workbench grid grid-cols-[minmax(0,1fr)] items-start gap-5">
      {/* sidebar */}
      <section
        id="tool-index"
        class="tool-sidebar grid max-h-[clamp(300px,42vh,430px)] grid-rows-[auto_auto_minmax(0,1fr)] gap-4 overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-soft-lift"
      >
        <div class="sidebar-head grid grid-cols-[minmax(0,1fr)_minmax(220px,320px)] items-center gap-3.5 max-xl:grid-cols-1">
          <div>
            <h2 class="m-0 text-lg">工具清单</h2>
            <p class="mt-0.5 mb-0 text-xs font-black uppercase text-muted">
              {props.tools.length} items
            </p>
          </div>
          <label class="tool-search">
            <span class="icon-[lucide--search] size-4 text-muted" />
            <input
              type="search"
              placeholder="搜索工具"
              aria-label="搜索工具"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </label>
        </div>

        <div
          class="filter-row flex flex-wrap items-center gap-2"
          aria-label="工具分类筛选"
        >
          <button
            class="filter-button"
            classList={{ "is-active": activeFilter() === "all" }}
            type="button"
            onClick={() => setActiveFilter("all")}
          >
            全部
          </button>
          <For each={props.categories}>
            {(category) => (
              <button
                class="filter-button"
                classList={{ "is-active": activeFilter() === category }}
                type="button"
                onClick={() => setActiveFilter(category)}
              >
                {category}
              </button>
            )}
          </For>
        </div>

        <div class="tool-list grid min-h-0 grid-cols-4 gap-3 overflow-y-auto pr-1 max-xl:grid-cols-2 max-md:grid-cols-1">
          <For each={filteredTools()}>
            {(tool) => (
              <a
                class="tool-card relative grid min-h-22 grid-cols-[34px_minmax(0,1fr)] gap-2.5 rounded-lg border border-border bg-surface-strong p-3 transition-[background,border-color] duration-150"
                classList={{
                  "is-active": activeTool() === tool.id,
                  "is-draft": tool.status === "draft",
                }}
                href={`#${tool.id}`}
                aria-current={activeTool() === tool.id ? "true" : "false"}
                onClick={(e) => onCardClick(e, tool.id)}
              >
                <span class="tool-icon grid size-9 place-items-center rounded-md border border-tag-border bg-blue-soft text-blue">
                  <span class={`${toolIconClass(tool.icon)} size-[19px]`} />
                </span>
                <span class="tool-copy">
                  <span class="tool-title">
                    <strong>{tool.name}</strong>
                    <small>
                      {tool.status === "draft" ? "草稿" : tool.category}
                    </small>
                  </span>
                  <em>{tool.description}</em>
                </span>
              </a>
            )}
          </For>
        </div>

        <Show when={filteredTools().length === 0}>
          <p class="empty-state m-0 text-sm text-muted">没有匹配的工具</p>
        </Show>
      </section>

      {/* tool stage */}
      <section
        class="tool-stage min-w-0 rounded-lg border border-border bg-surface p-4 shadow-soft-lift max-md:p-3.5"
        aria-live="polite"
      >
        <For each={props.tools}>{(tool) => renderPanel(tool)}</For>
      </section>
    </div>
  );
}
