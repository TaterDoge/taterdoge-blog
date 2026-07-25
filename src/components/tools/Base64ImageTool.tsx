import { createSignal } from "solid-js";

export default function Base64ImageTool() {
	const [status, setStatus] = createSignal("等待图片或 Base64");
	const [statusState, setStatusState] = createSignal<"ok" | "error">("ok");
	const [text, setText] = createSignal("");
	const [previewUrl, setPreviewUrl] = createSignal("");
	let fileInput: HTMLInputElement | undefined;
	let imageUrl = "";

	const updateStatus = (msg: string, isError = false) => {
		setStatus(msg);
		setStatusState(isError ? "error" : "ok");
	};

	const handleFileChange = (e: Event) => {
		const file = fileInput?.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			setText(result);
			setPreviewUrl(result);
			imageUrl = result;
			updateStatus(`${file.name} 已转为 Base64`);
		};
		reader.readAsDataURL(file);
	};

	const handleToText = () => {
		if (fileInput?.files?.[0]) handleFileChange(new Event("change"));
	};

	const handleToImage = () => {
		const raw = text().trim();
		if (!raw) return;
		imageUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
		setPreviewUrl(imageUrl);
		updateStatus("Base64 已还原为图片");
	};

	const handleDownload = () => {
		if (!imageUrl) return;
		const link = document.createElement("a");
		link.href = imageUrl;
		link.download = "base64-image.png";
		link.click();
	};

	return (
		<div class="workspace base64-image-workspace">
			<div class="base64-image-controls">
				<label class="file-inline">
					<span>图片</span>
					<input
						ref={fileInput}
						class="tool-control"
						type="file"
						accept="image/*"
						onChange={handleFileChange}
					/>
				</label>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={handleToText}>
						图片转 Base64
					</button>
					<button class="tool-button" type="button" onClick={handleToImage}>
						Base64 转图片
					</button>
					<button class="tool-button" type="button" onClick={handleDownload}>
						下载图片
					</button>
				</div>
			</div>
			<div class="base64-image-body">
				<div class="base64-image-preview">
					{previewUrl() && (
						<img src={previewUrl()} alt="" data-no-media-shell="true" />
					)}
				</div>
				<label>
					<span>Base64 / Data URL</span>
					<textarea
						class="tool-control tool-textarea compact code-text"
						spellcheck="false"
						value={text()}
						onInput={(e) => setText(e.currentTarget.value)}
					/>
				</label>
			</div>
			<div class="tool-footer">
				<p class="tool-status" data-state={statusState()}>
					{status()}
				</p>
			</div>
		</div>
	);
}
