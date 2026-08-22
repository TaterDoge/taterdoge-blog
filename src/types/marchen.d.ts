// 全站客户端脚本（src/scripts/*.ts）挂在 window 上的公共 API。
// 图片/装饰/搜索/导航等岛内代码通过可选链调用这些入口。
interface Window {
	// 播放器 frame 使用 vendored APlayer.js（无类型定义，见 music-player-frame.astro）
	APlayer: any;
	__marchenApplyTheme?: (root?: HTMLElement) => void;
	__marchenThemeSwapBound?: boolean;
	__marchenInitImages?: (root?: ParentNode) => void;
	__marchenRevealImage?: (image: HTMLImageElement) => void;
	__marchenImageObserver?: MutationObserver | null;
	__marchenImageSwapping?: boolean;
	__marchenDecorAbort?: AbortController | null;
	__marchenSyncPrivateNav?: () => void;
	__marchenSyncThemeToggle?: () => void;
	__marchenRefreshSearch?: () => void;
}
