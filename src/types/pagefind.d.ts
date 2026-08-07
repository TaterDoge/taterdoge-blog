export interface PagefindSearchResult {
	url: string;
	meta: { title: string; [key: string]: string };
	excerpt: string;
	content?: string;
	word_count?: number;
}

export interface PagefindApi {
	search(query: string): Promise<{
		results: Array<{ id: string; data(): Promise<PagefindSearchResult> }>;
	}>;
	options?(opts: Record<string, unknown>): Promise<void>;
	debouncedSearch?(
		query: string,
		options?: unknown,
		delay?: number,
	): Promise<{
		results: Array<{ id: string; data(): Promise<PagefindSearchResult> }>;
	} | null>;
}

declare global {
	interface Window {
		__marchenPagefind?: PagefindApi | null;
		__marchenPagefindPromise?: Promise<PagefindApi>;
		__marchenPagefindEnabled?: boolean;
		__marchenPagefindFailed?: boolean;
		__marchenLoadPagefind?: () => Promise<PagefindApi>;
		__marchenRefreshSearch?: () => void;
		__marchenSearchBound?: boolean;
	}
}
