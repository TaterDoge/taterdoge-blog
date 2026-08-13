#!/usr/bin/env bash
# 用 fonttools 把 MiSansVF.ttf 裁剪成站点按需的 WOFF2。
# 字符来源：源码/正文提取 + GB2312 一级汉字 + 常用符号兜底。
# 用法: bash scripts/subset-font.sh（需要 python3 + fonttools[woff2]）
set -euo pipefail
cd "$(dirname "$0")/.."

FONT=fonts-src/MiSansVF.ttf
OUT=public/fonts/MiSansVF.subset.woff2
CHARSET_CACHE=scripts/.charset.txt
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

python3 - "$TMP/chars.txt" <<'PY'
import glob, os, sys

chars = set()

# 1) 站点全部源码与内容文本
for pat in ("src/**/*", "public/**/*.svg", "*.md", "*.mjs", "*.json", "package.json"):
    for p in glob.glob(pat, recursive=True):
        if not os.path.isfile(p) or p.endswith((".ttf", ".otf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".lock")):
            continue
        try:
            chars.update(open(p, encoding="utf-8").read())
        except UnicodeDecodeError:
            pass

# 2) GB2312 一级常用汉字（区 16-55，3755 字），兜住之后新增的文章
for zone in range(16, 56):
    hi = 0xA0 + zone
    for i in range(1, 95):
        try:
            chars.add(bytes([hi, 0xA0 + i]).decode("gb2312"))
        except UnicodeDecodeError:
            pass

# 3) 常用符号兜底（排版/链接/装饰）
chars.update("·•◦‣–—―‘’“”…×÷±°℃©®™€£¥§¶←↑→↓↔↕↗↘✓✗★☆♪♫⌘⌥⇧⌃①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮")

chars.discard("\n"); chars.discard("\r"); chars.discard("\t"); chars.discard("\x00")
open(sys.argv[1], "w", encoding="utf-8").write("".join(sorted(chars)))
print(f"chars: {len(chars)}")
PY

# 源字体缺失（如 CI 环境）→ 沿用已提交的产物
if [ ! -f "$FONT" ]; then
	if [ -f "$OUT" ]; then
		echo "source font missing, keep existing subset"
		exit 0
	fi
	echo "error: $FONT not found" >&2
	exit 1
fi

# 字符集没变且产物还在 → 跳过裁剪（构建时零开销）
if [ -f "$OUT" ] && [ -f "$CHARSET_CACHE" ] && cmp -s "$CHARSET_CACHE" "$TMP/chars.txt"; then
	echo "charset unchanged, skip"
	exit 0
fi
cp "$TMP/chars.txt" "$CHARSET_CACHE"

# 保留可变字重轴（250-900）与全部 OpenType 排版特性
python3 -m fontTools.subset "$FONT" \
	--output-file="$OUT" \
	--flavor=woff2 \
	--text-file="$TMP/chars.txt" \
	--layout-features='*' \
	--name-IDs='*' \
	--glyph-names

ls -lh "$FONT" "$OUT"
