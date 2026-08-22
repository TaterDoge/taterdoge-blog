import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hasValidDirName } from "../src/lib/content-rules";

const blogRoot = path.resolve("src/content/blog");
const mediaExt = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".gifv",
]);
const localMediaRef =
  /!\[[^\]]*]\((\.\/|\.\.\/)([^)\s]+)\)|<img\b[^>]*\bsrc=["'](\.\/|\.\.\/)([^"']+)["']/gi;
// 目录名校验规则集中在 src/lib/content-rules.ts（与 publish-markdown.ts 共用）

type Issue = string;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".gitkeep" || entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

function isMedia(filePath: string) {
  return mediaExt.has(path.extname(filePath).toLowerCase());
}

function isPostIndex(filePath: string) {
  const base = path.basename(filePath).toLowerCase();
  return base === "index.md" || base === "index.mdx";
}

function isMarkdown(filePath: string) {
  return /\.mdx?$/i.test(filePath);
}

function depthFromBlog(filePath: string) {
  const rel = path.relative(blogRoot, filePath);
  if (!rel || rel.startsWith("..")) return -1;
  return rel.split(path.sep).filter(Boolean).length;
}

async function main() {
  const issues: Issue[] = [];
  let blogStat;
  try {
    blogStat = await stat(blogRoot);
  } catch {
    console.log("skip: src/content/blog not found");
    return;
  }
  if (!blogStat.isDirectory()) {
    issues.push("src/content/blog is not a directory");
    fail(issues);
  }

  const allFiles = await walk(blogRoot);
  const dirs = new Set<string>();
  for (const file of allFiles) dirs.add(path.dirname(file));

  // category dirs live directly under blog root
  const topEntries = await readdir(blogRoot, { withFileTypes: true });
  for (const entry of topEntries) {
    if (entry.name === ".gitkeep" || entry.name === ".DS_Store") continue;
    const full = path.join(blogRoot, entry.name);
    if (entry.isFile()) {
      issues.push(
        `blog 根目录禁止直接放文件，文章必须在 分类/文章/index.md: src/content/blog/${entry.name}`,
      );
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith(".assets")) {
      issues.push(`禁止 *.assets 目录: src/content/blog/${entry.name}`);
      continue;
    }
    if (!hasValidDirName(entry.name)) {
      issues.push(
        `分类目录名非法（勿含 /\\:*?"<>| 等）: src/content/blog/${entry.name}`,
      );
    }

    const postEntries = await readdir(full, { withFileTypes: true });
    for (const postEntry of postEntries) {
      if (postEntry.name === ".DS_Store") continue;
      const postFull = path.join(full, postEntry.name);
      if (postEntry.isFile()) {
        issues.push(
          `分类目录下禁止直接放文件，文章必须是独立目录: src/content/blog/${entry.name}/${postEntry.name}`,
        );
        continue;
      }
      if (!postEntry.isDirectory()) continue;
      if (postEntry.name.endsWith(".assets")) {
        issues.push(
          `禁止 *.assets 目录: src/content/blog/${entry.name}/${postEntry.name}`,
        );
        continue;
      }
      if (!hasValidDirName(postEntry.name)) {
        issues.push(
          `文章目录名非法（勿含 /\\:*?"<>| 等）: src/content/blog/${entry.name}/${postEntry.name}`,
        );
      }
      const indexMd = path.join(postFull, "index.md");
      const indexMdx = path.join(postFull, "index.mdx");
      const hasIndex =
        allFiles.includes(indexMd) || allFiles.includes(indexMdx);
      if (!hasIndex) {
        issues.push(
          `文章目录缺少 index.md(x): src/content/blog/${entry.name}/${postEntry.name}`,
        );
      }
    }
  }

  for (const dir of dirs) {
    const relDir = path.relative(blogRoot, dir) || ".";
    if (path.basename(dir).endsWith(".assets")) {
      issues.push(`禁止 *.assets 目录: src/content/blog/${relDir}`);
    }
  }

  for (const file of allFiles) {
    const rel = path.relative(blogRoot, file);
    const parent = path.dirname(file);
    const parentRel = path.relative(blogRoot, parent) || ".";
    const depth = depthFromBlog(file);

    if (isMedia(file)) {
      // media only inside post dir: category/post/file
      if (depth !== 3) {
        issues.push(`媒体文件只能放在文章目录内: src/content/blog/${rel}`);
        continue;
      }
      const hasIndex = allFiles.some(
        (candidate) =>
          path.dirname(candidate) === parent && isPostIndex(candidate),
      );
      if (!hasIndex) {
        issues.push(
          `含媒体的目录缺少 index.md(x): src/content/blog/${parentRel}`,
        );
      }
    }

    if (!isMarkdown(file)) continue;

    // only allow category/post/index.md
    if (!isPostIndex(file) || depth !== 3) {
      issues.push(
        `文章必须是 分类/文章/index.md 结构: src/content/blog/${rel}`,
      );
      continue;
    }

    const body = await readFile(file, "utf8");
    const refs: string[] = [];
    for (const match of body.matchAll(localMediaRef)) {
      refs.push(match[2] || match[4]);
    }
    for (const ref of refs) {
      if (ref.startsWith("../")) {
        issues.push(
          `本地资源不要引用上级目录: src/content/blog/${rel} -> ${ref}`,
        );
      }
    }
  }

  if (issues.length) fail([...new Set(issues)]);
  console.log("content check passed");
}

function fail(issues: Issue[]): never {
  console.error(
    "content check failed:\n" + issues.map((issue) => `- ${issue}`).join("\n"),
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
