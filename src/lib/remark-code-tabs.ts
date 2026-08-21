import type { Plugin } from "unified";
import type { Root, Code } from "mdast";

/**
 * 代码 Tab：把连续多个带文件名的 fenced code block 合并为 tab 组。
 *
 * 用法：语言标识后加空格写文件名，如 ```ts agent.ts
 * 连续 ≥2 个带文件名的代码块会合并成 <div class="code-tabs">；
 * tab 切换用纯 CSS radio（:checked ~ pre 显示对应面板），零 JS。
 * 超过 MAX_FILES 个的组不合并，保持原样。
 */

const FILE_META_PATTERN = /^[^\s{}]+\.\w+$/;
const MAX_FILES = 8;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const remarkCodeTabs: Plugin<[], Root> = () => (tree) => {
  const children = tree.children;
  const result: typeof children = [];
  let groupId = 0;
  let index = 0;

  while (index < children.length) {
    const node = children[index];

    if (node.type === "code" && FILE_META_PATTERN.test(node.meta ?? "")) {
      const group: Code[] = [];
      while (
        index < children.length &&
        children[index].type === "code" &&
        FILE_META_PATTERN.test((children[index] as Code).meta ?? "")
      ) {
        group.push(children[index] as Code);
        index++;
      }

      if (group.length >= 2 && group.length <= MAX_FILES) {
        groupId++;
        const name = `code-tabs-${groupId}`;
        const copyBtn =
          '<button type="button" class="tabs-copy-btn" aria-label="Copy code"><span class="copy-btn-icon">' +
          '<svg viewBox="0 -960 960 960" class="copy-btn-icon copy-icon"><path d="M368.37-237.37q-34.48 0-58.74-24.26-24.26-24.26-24.26-58.74v-474.26q0-34.48 24.26-58.74 24.26-24.26 58.74-24.26h378.26q34.48 0 58.74 24.26 24.26 24.26 24.26 58.74v474.26q0 34.48-24.26 58.74-24.26 24.26-58.74 24.26H368.37Zm0-83h378.26v-474.26H368.37v474.26Zm-155 238q-34.48 0-58.74-24.26-24.26-24.26-24.26-58.74v-515.76q0-17.45 11.96-29.48 11.97-12.02 29.33-12.02t29.54 12.02q12.17 12.03 12.17 29.48v515.76h419.76q17.45 0 29.48 11.96 12.02 11.97 12.02 29.33t-12.02 29.54q-12.03 12.17-29.48 12.17H213.37Zm155-238v-474.26 474.26Z"></path></svg>' +
          '<svg viewBox="0 -960 960 960" class="copy-btn-icon success-icon"><path d="m389-377.13 294.7-294.7q12.58-12.67 29.52-12.67 16.93 0 29.61 12.67 12.67 12.68 12.67 29.53 0 16.86-12.28 29.14L419.07-288.41q-12.59 12.67-29.52 12.67-16.94 0-29.62-12.67L217.41-430.93q-12.67-12.68-12.79-29.45-.12-16.77 12.55-29.45 12.68-12.67 29.62-12.67 16.93 0 29.28 12.67L389-377.13Z"></path></svg></span></button>';
        result.push({
          type: "html",
          value: `<div class="code-tabs"><div class="code-tabs-bar">`,
        });
        group.forEach((code, i) => {
          const file = escapeHtml((code.meta as string).trim());
          result.push({
            type: "html",
            value: `<input type="radio" name="${name}" id="${name}-${i}"${i === 0 ? " checked" : ""}><label for="${name}-${i}">${file}</label>`,
          });
        });
        result.push({ type: "html", value: `${copyBtn}</div>` });
        result.push(...group);
        result.push({ type: "html", value: `</div>` });
      } else {
        result.push(...group);
      }
      continue;
    }

    result.push(node);
    index++;
  }

  tree.children = result;
};
