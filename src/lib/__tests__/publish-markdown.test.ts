import { describe, expect, it } from "bun:test";
import {
	buildMarkdown,
	cleanDirName,
	frontmatter,
	projectObject,
	toList,
} from "@/lib/publish-markdown";

describe("toList", () => {
	it("分割中英文逗号与换行", () => {
		expect(toList("a, b，c\n d")).toEqual(["a", "b", "c", "d"]);
	});
	it("数组输入逐项 trim 过滤空", () => {
		expect(toList([" x ", "", "y"])).toEqual(["x", "y"]);
	});
	it("空输入返回空数组", () => {
		expect(toList(undefined)).toEqual([]);
		expect(toList("")).toEqual([]);
	});
});

describe("cleanDirName", () => {
	it("过滤文件系统非法字符并压缩空白", () => {
		expect(cleanDirName('a/b\\c:d*e?"f<g>h|i#%', "f")).toBe("abcdefghi");
	});
	it("截断到 80 字符", () => {
		expect(cleanDirName("x".repeat(100), "f").length).toBe(80);
	});
	it("空值回退 fallback", () => {
		expect(cleanDirName("", "fallback")).toBe("fallback");
		expect(cleanDirName(undefined, "f")).toBe("f");
	});
	it("拒绝 `.`/`..` 路径逃逸", () => {
		expect(() => cleanDirName(".", "f")).toThrow(/Invalid directory name/);
		expect(() => cleanDirName("..", "f")).toThrow(/Invalid directory name/);
		expect(cleanDirName("...", "f")).toBe("...");
	});
	it("非空但清洗后为空（全非法字符）抛错；全空白回退 fallback", () => {
		expect(() => cleanDirName("###", "f")).toThrow(/Invalid directory name/);
		expect(cleanDirName("   ", "f")).toBe("f");
	});
});

describe("frontmatter", () => {
	it("过滤空值、数组用 YAML 列表、布尔原样输出", () => {
		const out = frontmatter([
			["title", 'a"b'],
			["tags", ["Go", "astro"]],
			["draft", false],
			["skip", ""],
			["omit", undefined],
		]);
		expect(out).toBe(
			'---\ntitle: "a\\"b"\ntags: ["Go", "astro"]\ndraft: false\n---',
		);
	});
});

describe("buildMarkdown", () => {
	it("blog 生成目录结构与 frontmatter", () => {
		const { filePath, content, message } = buildMarkdown({
			type: "blog",
			title: "测试文章",
			body: "正文",
			description: "摘要",
			category: "学习笔记",
			tags: "Go, astro",
			visibility: "public",
			pubDate: "2026-03-23",
		});
		expect(filePath).toBe("src/content/blog/学习笔记/测试文章/index.md");
		expect(content).toContain('pubDate: "2026-03-23"');
		expect(content).toContain('visibility: "public"');
		expect(content).toContain('tags: ["Go", "astro"]');
		expect(content).toContain("\n\n正文\n");
		expect(message).toBe("content(blog): publish 学习笔记/测试文章");
	});
	it("note 生成碎念路径, 不含 category", () => {
		const out = buildMarkdown({
			type: "note",
			title: "碎念",
			body: "内容",
		});
		expect(out.filePath).toBe("src/content/notes/碎念.md");
		expect(out.content).not.toContain("category:");
	});
	it("非法类型/缺字段抛错", () => {
		expect(() =>
			buildMarkdown({ type: "project", title: "x", body: "y" }),
		).toThrow("Invalid publish type.");
		expect(() => buildMarkdown({ type: "blog", body: "y" })).toThrow(
			"Title is required.",
		);
		expect(() =>
			buildMarkdown({ type: "blog", title: "x", body: "", description: "d" }),
		).toThrow("Body is required.");
		expect(() =>
			buildMarkdown({
				type: "blog",
				title: "x",
				body: "y",
				description: "d",
			}),
		).toThrow("Category is required for blog posts.");
	});
	it("blog 缺 description 抛错", () => {
		expect(() =>
			buildMarkdown({ type: "blog", title: "x", body: "y", category: "c" }),
		).toThrow("Description is required for blog posts.");
	});
	it("blog cover 拒绝远程 URL", () => {
		expect(() =>
			buildMarkdown({
				type: "blog",
				title: "x",
				body: "y",
				description: "d",
				category: "c",
				cover: "https://example.com/cover.png",
			}),
		).toThrow(/Cover must be a local image path/);
		const ok = buildMarkdown({
			type: "blog",
			title: "x",
			body: "y",
			description: "d",
			category: "c",
			cover: "./cover.png",
		});
		expect(ok.content).toContain('cover: "./cover.png"');
	});
	it("非法 pubDate 抛错", () => {
		expect(() =>
			buildMarkdown({
				type: "note",
				title: "x",
				body: "y",
				pubDate: "not-a-date",
			}),
		).toThrow(/Invalid pubDate/);
	});
});

describe("projectObject", () => {
	it("生成 TS 对象字面量", () => {
		const out = projectObject({
			title: "项目",
			description: "简介",
			category: "自动化工具",
			github: "https://github.com/x/y",
			techStack: "Python",
			tags: "Python",
			status: "维护中",
			featured: true,
		});
		expect(out).toContain('name: "项目",');
		expect(out).toContain('techStack: ["Python"],');
		expect(out).toContain("featured: true,");
	});
	it("缺必填字段抛错", () => {
		expect(() => projectObject({ title: "x" })).toThrow(
			"Project description is required.",
		);
	});
});
