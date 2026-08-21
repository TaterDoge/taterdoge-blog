import { definePlugin } from "@expressive-code/core";
import type { Element } from "hast";

export function pluginCustomCopyButton() {
	return definePlugin({
		name: "Custom Copy Button",
		hooks: {
			postprocessRenderedBlock: (context) => {
				function traverse(node: Element, parent: Element | null = null) {
					if (node.type === "element" && node.tagName === "pre") {
						processCodeBlock(node, parent);
						return;
					}
					if (node.children) {
						for (const child of node.children) {
							if (child.type === "element") traverse(child, node);
						}
					}
				}

				function hasCopyBtn(el: Element | null) {
					return Boolean(
						el?.children?.some(
							(c) =>
								c.type === "element" &&
								c.tagName === "button" &&
								(Array.isArray(c.properties?.className)
									? c.properties.className
									: []
								).includes("copy-btn"),
						),
					);
				}

				function processCodeBlock(node: Element, frame: Element | null) {
					// 按钮必须放在 <pre> 之外（frame 内 pre 前）：
					// 1) 若在 pre 内，pre 的 overflow-x:auto 会使其 overflow-y 被 CSS 规范计算为 auto，
					//    成为最近的纵向滚动容器，抢走 sticky 的锚点，滚动时按钮会跟内容一起滚走；
					// 2) 放 frame 内、pre 前则最近纵向滚动容器是 .expressive-code 本身，sticky 生效。
					// 幂等：postprocess 可能对同一块重复调用，已有按钮则跳过，避免重复插入。
					if (hasCopyBtn(frame)) return;

					const copyButton = {
						type: "element" as const,
						tagName: "button",
						properties: {
							className: ["copy-btn"],
							"aria-label": "Copy code",
						},
						children: [
							{
								type: "element" as const,
								tagName: "div",
								properties: {
									className: ["copy-btn-icon"],
								},
								children: [
									{
										type: "element" as const,
										tagName: "svg",
										properties: {
											viewBox: "0 -960 960 960",
											xmlns: "http://www.w3.org/2000/svg",
											className: ["copy-btn-icon", "copy-icon"],
										},
										children: [
											{
												type: "element" as const,
												tagName: "path",
												properties: {
													d: "M368.37-237.37q-34.48 0-58.74-24.26-24.26-24.26-24.26-58.74v-474.26q0-34.48 24.26-58.74 24.26-24.26 58.74-24.26h378.26q34.48 0 58.74 24.26 24.26 24.26 24.26 58.74v474.26q0 34.48-24.26 58.74-24.26 24.26-58.74 24.26H368.37Zm0-83h378.26v-474.26H368.37v474.26Zm-155 238q-34.48 0-58.74-24.26-24.26-24.26-24.26-58.74v-515.76q0-17.45 11.96-29.48 11.97-12.02 29.33-12.02t29.54 12.02q12.17 12.03 12.17 29.48v515.76h419.76q17.45 0 29.48 11.96 12.02 11.97 12.02 29.33t-12.02 29.54q-12.03 12.17-29.48 12.17H213.37Zm155-238v-474.26 474.26Z",
												},
												children: [],
											},
										],
									},
									{
										type: "element" as const,
										tagName: "svg",
										properties: {
											viewBox: "0 -960 960 960",
											xmlns: "http://www.w3.org/2000/svg",
											className: ["copy-btn-icon", "success-icon"],
										},
										children: [
											{
												type: "element" as const,
												tagName: "path",
												properties: {
													d: "m389-377.13 294.7-294.7q12.58-12.67 29.52-12.67 16.93 0 29.61 12.67 12.67 12.68 12.67 29.53 0 16.86-12.28 29.14L419.07-288.41q-12.59 12.67-29.52 12.67-16.94 0-29.62-12.67L217.41-430.93q-12.67-12.68-12.79-29.45-.12-16.77 12.55-29.45 12.68-12.67 29.62-12.67 16.93 0 29.28 12.67L389-377.13Z",
												},
												children: [],
											},
										],
									},
								],
							},
						],
					} as Element;

					if (frame && frame.children) {
						const idx = frame.children.indexOf(node);
						frame.children.splice(Math.max(0, idx), 0, copyButton);
					} else if (node.children) {
						// fallback：拿不到父级时退回旧行为（保持不崩）
						node.children.unshift(copyButton);
					}
				}

				traverse(context.renderData.blockAst);
			},
		},
	});
}
