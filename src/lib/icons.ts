/**
 * Lucide 图标类名映射（PascalCase / kebab 名称 → Tailwind iconify utility）。
 * 必须用全字面量映射：Tailwind 扫描器只能识别源码中的完整类名，
 * 动态拼接 `icon-[lucide--${name}]` 不会生成任何 CSS。
 * 未知名称回退到 wrench 占位。
 */
const ICON_CLASS: Record<string, string> = {
	// 工具（src/data/tools.ts）
	Binary: "icon-[lucide--binary]",
	Braces: "icon-[lucide--braces]",
	Clock: "icon-[lucide--clock]",
	Clock3: "icon-[lucide--clock-3]",
	Code2: "icon-[lucide--code-2]",
	FileImage: "icon-[lucide--file-image]",
	Fingerprint: "icon-[lucide--fingerprint]",
	GitCompare: "icon-[lucide--git-compare]",
	Hash: "icon-[lucide--hash]",
	Image: "icon-[lucide--image]",
	KeyRound: "icon-[lucide--key-round]",
	Link: "icon-[lucide--link]",
	Palette: "icon-[lucide--palette]",
	Pilcrow: "icon-[lucide--pilcrow]",
	QrCode: "icon-[lucide--qr-code]",
	Regex: "icon-[lucide--regex]",
	Sparkles: "icon-[lucide--sparkles]",
	// 收藏（src/data/favorites.ts）
	Database: "icon-[lucide--database]",
	Github: "icon-[lucide--github]",
	PencilRuler: "icon-[lucide--pencil-ruler]",
	Triangle: "icon-[lucide--triangle]",
	Zap: "icon-[lucide--zap]",
	// 管理 / 发布页 kebab 名
	"book-open": "icon-[lucide--book-open]",
	images: "icon-[lucide--images]",
	rocket: "icon-[lucide--rocket]",
	wrench: "icon-[lucide--wrench]",
	bookmark: "icon-[lucide--bookmark]",
	save: "icon-[lucide--save]",
	"folder-plus": "icon-[lucide--folder-plus]",
	plus: "icon-[lucide--plus]",
	x: "icon-[lucide--x]",
	// 默认/兜底
	Bookmark: "icon-[lucide--bookmark]",
	Send: "icon-[lucide--send]",
	Save: "icon-[lucide--save]",
	FolderPlus: "icon-[lucide--folder-plus]",
	Plus: "icon-[lucide--plus]",
	X: "icon-[lucide--x]",
};

export function lucideIconClass(name: string): string {
	return ICON_CLASS[name] ?? "icon-[lucide--wrench]";
}
