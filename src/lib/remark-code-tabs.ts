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
				result.push({ type: "html", value: `<div class="code-tabs">` });
				group.forEach((code, i) => {
					const file = escapeHtml((code.meta as string).trim());
					result.push({
						type: "html",
						value: `<input type="radio" name="${name}" id="${name}-${i}"${i === 0 ? " checked" : ""}><label for="${name}-${i}">${file}</label>`,
					});
				});
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
