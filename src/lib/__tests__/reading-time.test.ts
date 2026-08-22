import { describe, expect, it } from "bun:test";
import { getReadingMinutes } from "@/lib/reading-time";

describe("getReadingMinutes", () => {
	it("纯中文按 500 字/分钟", () => {
		expect(getReadingMinutes("字".repeat(1000))).toBe(2);
		expect(getReadingMinutes("字".repeat(499))).toBe(1);
	});
	it("纯英文按 220 词/分钟", () => {
		expect(getReadingMinutes("word ".repeat(440))).toBe(2);
	});
	it("代码块不计数", () => {
		const text = "```\n" + "word ".repeat(500) + "\n```\n正文";
		expect(getReadingMinutes(text)).toBe(1);
	});
	it("空文本至少 1 分钟", () => {
		expect(getReadingMinutes("")).toBe(1);
		expect(getReadingMinutes(undefined)).toBe(1);
	});
	it("中英混排分别计算", () => {
		const minutes = getReadingMinutes(
			"中".repeat(500) + " " + "word ".repeat(220),
		);
		expect(minutes).toBe(2);
	});
});
