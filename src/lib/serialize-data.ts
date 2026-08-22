// TS 数据文件序列化纯函数（/admin/manage 保存 projects/tools/favorites 时使用）。

function quote(value: string) {
	return JSON.stringify(value);
}

export function serializeValue(value: unknown, indent = 2): string {
	const pad = " ".repeat(indent);
	const childPad = " ".repeat(indent + 2);

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		if (value.every((item) => typeof item !== "object" || item === null)) {
			return `[${value.map((item) => serializeValue(item, indent)).join(", ")}]`;
		}
		return `[\n${value.map((item) => `${childPad}${serializeValue(item, indent + 2)}`).join(",\n")}\n${pad}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value).filter(
			([, item]) => item !== undefined && item !== "",
		);
		if (entries.length === 0) return "{}";
		return `{\n${entries.map(([key, item]) => `${childPad}${key}: ${serializeValue(item, indent + 2)},`).join("\n")}\n${pad}}`;
	}

	if (typeof value === "string") return quote(value);
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "null";
}
