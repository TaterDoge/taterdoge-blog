import { createSignal } from "solid-js";

type PublishType = "blog" | "note" | "project";
type StatusState = "idle" | "loading" | "ok" | "error";

interface PublishAppProps {
	initialType: PublishType;
}

export default function PublishApp(props: PublishAppProps) {
	const [activeType, setActiveType] = createSignal<PublishType>(
		props.initialType,
	);
	const [status, setStatus] = createSignal<{
		message: string;
		state: StatusState;
	}>({ message: "等待填写内容", state: "idle" });
	const [submitting, setSubmitting] = createSignal(false);
	let formRef: HTMLFormElement | undefined;

	const isBlog = () => activeType() === "blog";
	const isNote = () => activeType() === "note";
	const isProject = () => activeType() === "project";
	const isContent = () => activeType() !== "project";
	const isDescription = () => activeType() !== "note";
	const descRequired = () => isBlog() || isProject();

	const statusColor = () => {
		const s = status().state;
		if (s === "ok") return "text-blue";
		if (s === "error") return "text-status-error";
		return "text-muted";
	};

	const renderTab = (type: PublishType, icon: string, label: string) => (
		<button
			class="publish-tab"
			classList={{ "is-active": activeType() === type }}
			type="button"
			onClick={() => setActiveType(type)}
		>
			<span class={`icon--lucide--${icon} size-[17px]`} />
			{label}
		</button>
	);

	const handleSubmit = async (e: SubmitEvent) => {
		e.preventDefault();
		if (!formRef) return;
		const data = new FormData(formRef);
		const type = activeType();
		const payload = {
			type,
			title: String(data.get("title") || ""),
			slug: String(data.get("slug") || ""),
			description: String(data.get("description") || ""),
			category: String(data.get("category") || ""),
			mood: String(data.get("mood") || ""),
			techStack: String(data.get("techStack") || ""),
			tags: String(data.get("tags") || ""),
			visibility: String(data.get("visibility") || "public"),
			draft: data.get("draft") === "on",
			cover: String(data.get("cover") || ""),
			syncToKb: data.get("syncToKb") === "on",
			images: String(data.get("images") || ""),
			github: String(data.get("github") || ""),
			demo: String(data.get("demo") || ""),
			status: String(data.get("status") || ""),
			featured: data.get("featured") === "on",
			body: String(data.get("body") || ""),
		};

		setSubmitting(true);
		setStatus({ message: "正在发布...", state: "loading" });
		try {
			const response = await fetch("/api/admin/publish", {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify(payload),
			});
			const result = await response.json();
			if (!response.ok || !result?.ok)
				throw new Error(result?.error || "发布失败");
			setStatus({ message: `已提交：${result.path}`, state: "ok" });
			formRef.reset();
			setActiveType(type);
		} catch (error) {
			setStatus({
				message: error instanceof Error ? error.message : "发布失败",
				state: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	const INPUT_DISABLED = (visible: () => boolean) => !visible();

	return (
		<section class="publish-panel mx-auto grid w-full max-w-[980px] gap-4">
			<div
				class="inline-flex w-fit justify-self-center gap-2 border-b border-border-soft pb-2.5"
				role="tablist"
				aria-label="发布类型"
			>
				{renderTab("blog", "book-open", "文章")}
				{renderTab("note", "images", "碎念")}
				{renderTab("project", "rocket", "项目")}
			</div>

			<form ref={formRef} class="grid w-full gap-4" onSubmit={handleSubmit}>
				<input type="hidden" name="type" value={activeType()} />

				{/* title + slug */}
				<div class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2">
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">标题</span>
						<input name="title" required placeholder="给这条内容起个名字" />
					</label>
					<label
						class="grid min-w-0 gap-2 font-black text-ink"
						hidden={!isContent()}
					>
						<span class="text-sm">文件名 slug</span>
						<input
							name="slug"
							placeholder="留空会自动生成"
							disabled={INPUT_DISABLED(isContent)}
						/>
					</label>
				</div>

				{/* description + category */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isDescription()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">描述</span>
						<input
							name="description"
							placeholder="文章摘要或项目介绍，列表页会展示"
							required={descRequired()}
							disabled={INPUT_DISABLED(isDescription)}
						/>
					</label>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">分类</span>
						<input
							name="category"
							placeholder="学习笔记 / 项目日志 / 前端实验"
							required={descRequired()}
							disabled={INPUT_DISABLED(isDescription)}
						/>
					</label>
				</div>

				{/* github + demo (project) */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isProject()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">GitHub 链接</span>
						<input
							name="github"
							placeholder="https://github.com/marchen-orz/project"
							required={isProject()}
							disabled={INPUT_DISABLED(isProject)}
						/>
					</label>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">演示地址</span>
						<input
							name="demo"
							placeholder="没有就留空"
							disabled={INPUT_DISABLED(isProject)}
						/>
					</label>
				</div>

				{/* techStack + status (project) */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isProject()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">技术栈</span>
						<input
							name="techStack"
							placeholder="React, TypeScript, Astro"
							disabled={INPUT_DISABLED(isProject)}
						/>
					</label>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">状态</span>
						<input
							name="status"
							placeholder="维护中 / 已发布"
							disabled={INPUT_DISABLED(isProject)}
						/>
					</label>
				</div>

				{/* mood + images (note) */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isNote()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">心情</span>
						<input
							name="mood"
							placeholder="记录 / 整理 / 日常"
							disabled={INPUT_DISABLED(isNote)}
						/>
					</label>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">图片 URL</span>
						<input
							name="images"
							placeholder="多个图片用逗号分隔"
							disabled={INPUT_DISABLED(isNote)}
						/>
					</label>
				</div>

				{/* tags + visibility */}
				<div class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2">
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">标签</span>
						<input name="tags" placeholder="多个标签用逗号分隔" />
					</label>
					<label
						class="grid min-w-0 gap-2 font-black text-ink"
						hidden={!isContent()}
					>
						<span class="text-sm">可见性</span>
						<select name="visibility" disabled={INPUT_DISABLED(isContent)}>
							<option value="public">公开</option>
							<option value="private">私有</option>
						</select>
					</label>
				</div>

				{/* blog cover + draft/syncToKb */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isBlog()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">封面 URL</span>
						<input
							name="cover"
							placeholder="可选，文章卡片封面"
							disabled={INPUT_DISABLED(isBlog)}
						/>
					</label>
					<div class="flex flex-wrap items-end gap-3">
						<label class="inline-flex min-h-[39px] items-center gap-2 font-black text-ink">
							<input
								class="w-auto"
								name="draft"
								type="checkbox"
								disabled={INPUT_DISABLED(isBlog)}
							/>
							<span class="text-sm">保存为草稿</span>
						</label>
						<label class="inline-flex min-h-[39px] items-center gap-2 font-black text-ink">
							<input
								class="w-auto"
								name="syncToKb"
								type="checkbox"
								disabled={INPUT_DISABLED(isBlog)}
							/>
							<span class="text-sm">同步到知识库</span>
						</label>
					</div>
				</div>

				{/* project cover + featured */}
				<div
					class="grid gap-3.5 max-md:grid-cols-1 min-md:grid-cols-2"
					hidden={!isProject()}
				>
					<label class="grid min-w-0 gap-2 font-black text-ink">
						<span class="text-sm">封面 URL</span>
						<input
							name="cover"
							placeholder="没有则使用默认项目图"
							disabled={INPUT_DISABLED(isProject)}
						/>
					</label>
					<div class="flex flex-wrap items-end gap-3">
						<label class="inline-flex min-h-[39px] items-center gap-2 font-black text-ink">
							<input
								class="w-auto"
								name="featured"
								type="checkbox"
								disabled={INPUT_DISABLED(isProject)}
							/>
							<span class="text-sm">首页精选</span>
						</label>
					</div>
				</div>

				{/* body textarea */}
				<label
					class="grid min-w-0 gap-2 font-black text-ink"
					hidden={!isContent()}
				>
					<span class="text-sm">正文 Markdown</span>
					<textarea
						name="body"
						required
						placeholder="正文支持 Markdown。碎念可以直接写短句，文章可以写完整段落。"
						disabled={INPUT_DISABLED(isContent)}
					/>
				</label>

				<div class="publish-actions flex flex-wrap items-center gap-4 pt-1">
					<button
						class="button min-h-[42px] min-w-[118px] px-4 py-2"
						type="submit"
						disabled={submitting()}
					>
						<span class="icon--lucide--send size-[17px]" />
						发布
					</button>
					<output class={`text-sm font-extrabold ${statusColor()}`}>
						{status().message}
					</output>
				</div>
			</form>
		</section>
	);
}
