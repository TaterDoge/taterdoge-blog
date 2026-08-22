import { describe, expect, it } from "bun:test";
import { serializeValue } from "@/lib/serialize-data";

describe("serializeValue", () => {
	it("字符串/布尔/数字原样输出", () => {
		expect(serializeValue("a")).toBe('"a"');
		expect(serializeValue(true)).toBe("true");
		expect(serializeValue(42)).toBe("42");
		expect(serializeValue(NaN)).toBe("null");
		expect(serializeValue(null)).toBe("null");
	});
	it("空数组/空对象", () => {
		expect(serializeValue([])).toBe("[]");
		expect(serializeValue({})).toBe("{}");
	});
	it("原始值数组单行输出", () => {
		expect(serializeValue(["a", "b"])).toBe('["a", "b"]');
	});
	it("对象数组多行缩进输出", () => {
		const out = serializeValue([{ name: "x", n: 1 }]);
		expect(out).toBe('[\n    {\n      name: "x",\n      n: 1,\n    }\n  ]');
	});
	it("过滤 undefined 与空字符串字段", () => {
		const out = serializeValue({ a: "x", b: undefined, c: "" });
		expect(out).toBe('{\n    a: "x",\n  }');
	});
	it("嵌套对象", () => {
		expect(serializeValue({ a: { b: ["c"] } })).toBe(
			'{\n    a: {\n      b: ["c"],\n    },\n  }',
		);
	});
});
