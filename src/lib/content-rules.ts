/**
 * 内容目录名规则的唯一来源。
 * 被 scripts/check-content.ts（校验）、src/lib/publish-markdown.ts（清洗生成）共用；
 * 变更合法性语义时只需改这里，两处自动保持一致。
 *
 * 约定：cleanDirName 产物必须能通过 hasValidDirName。
 */

/** 校验：仅允许可读目录名，禁止文件系统非法字符与首尾空白 */
export function hasValidDirName(name: string): boolean {
	if (!name || name === "." || name === "..") return false;
	if (/[/\\:*?"<>|\n\r\t]/.test(name)) return false;
	if (name !== name.trim()) return false;
	return true;
}

/** 清洗：保留中文可读目录名；仅去掉文件系统非法字符 */
export function cleanDirName(value: string | undefined, fallback: string) {
	const raw = (value ?? "").trim();
	const name = (raw || fallback)
		.trim()
		.replace(/[/\\:*?"<>|#%]+/g, "")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/\s+/g, " ")
		.slice(0, 80)
		.trim();

	// `.`/`..` 会被 GitHub contents URL 规范化逃逸出目标目录；
	// 非空但清洗后为空（全空白/全非法字符）显式报错，不静默回退。
	if (!name || name === "." || name === "..") {
		throw new Error(`Invalid directory name: ${JSON.stringify(raw || fallback)}`);
	}
	return name;
}
