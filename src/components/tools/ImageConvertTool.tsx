import { createSignal } from "solid-js";

interface ImageState {
	fileName: string;
	url: string;
	blob: Blob | null;
}

function readImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => resolve({ img, url });
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("图片读取失败"));
		};
		img.src = url;
	});
}

export default function ImageConvertTool() {
	const [status, setStatus] = createSignal("等待图片");
	const [statusState, setStatusState] = createSignal<"ok" | "error">("ok");
	const [previewUrl, setPreviewUrl] = createSignal("");
	const [base64Output, setBase64Output] = createSignal("");
	const [format, setFormat] = createSignal("image/webp");
	const [quality, setQuality] = createSignal("0.82");
	let fileInput: HTMLInputElement | undefined;
	let canvas: HTMLCanvasElement | undefined;
	const imageState: ImageState = { fileName: "", url: "", blob: null };

	const updateStatus = (msg: string, isError = false) => {
		setStatus(msg);
		setStatusState(isError ? "error" : "ok");
	};

	const handleFileChange = async (e: Event) => {
		const file = e.target instanceof HTMLInputElement ? fileInput?.files?.[0] : undefined;
		if (!file) return;
		try {
			if (imageState.url) URL.revokeObjectURL(imageState.url);
			imageState.fileName = file.name.replace(/\.[^.]+$/, "");
			imageState.blob = null;
			const loaded = await readImage(file);
			imageState.url = loaded.url;
			setPreviewUrl(loaded.url);
			setBase64Output("");
			updateStatus(`${file.name} / ${(file.size / 1024).toFixed(1)} KB`);
		} catch (error) {
			updateStatus(error instanceof Error ? error.message : "图片读取失败", true);
		}
	};

	const handleConvert = async () => {
		try {
			const file = fileInput?.files?.[0];
			if (!file) throw new Error("请先选择图片");
			if (!canvas) throw new Error("当前浏览器不支持 Canvas");
			const { img } = await readImage(file);
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("当前浏览器无法创建 Canvas 上下文");
			context.drawImage(img, 0, 0);
			const type = format() || "image/webp";
			const q = Number.parseFloat(quality() || "0.82");
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, type, q),
			);
			if (!blob) throw new Error("图片转换失败");
			imageState.blob = blob;
			updateStatus(`已转换 / ${(blob.size / 1024).toFixed(1)} KB`);
			setBase64Output("");
		} catch (error) {
			updateStatus(error instanceof Error ? error.message : "图片转换失败", true);
		}
	};

	const handleDownload = () => {
		if (!imageState.blob) {
			updateStatus("请先转换图片", true);
			return;
		}
		const type = format() || "image/webp";
		const ext = type.includes("jpeg") ? "jpg" : type.split("/")[1];
		const link = document.createElement("a");
		link.href = URL.createObjectURL(imageState.blob);
		link.download = `${imageState.fileName || "image"}.${ext}`;
		link.click();
	};

	const handleBase64 = () => {
		if (!imageState.blob) {
			updateStatus("请先转换图片", true);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => setBase64Output(String(reader.result ?? ""));
		reader.readAsDataURL(imageState.blob);
	};

	return (
		<div class="workspace image-convert-workspace">
			<div class="image-convert-controls">
				<label class="file-inline">
					<span>图片</span>
					<input
						ref={fileInput}
						class="tool-control"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						onChange={handleFileChange}
					/>
				</label>
				<label>
					<span>输出格式</span>
					<select
						class="tool-control"
						value={format()}
						onChange={(e) => setFormat(e.currentTarget.value)}
					>
						<option value="image/webp">WebP</option>
						<option value="image/jpeg">JPG</option>
						<option value="image/png">PNG</option>
					</select>
				</label>
				<label>
					<span>质量</span>
					<input
						class="tool-control"
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						value={quality()}
						onInput={(e) => setQuality(e.currentTarget.value)}
					/>
				</label>
			</div>
			<div class="tool-footer">
				<output class="tool-result image-convert-status" data-state={statusState()}>
					{status()}
				</output>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={handleConvert}>
						转换
					</button>
					<button class="tool-button" type="button" onClick={handleDownload}>
						下载
					</button>
					<button class="tool-button" type="button" onClick={handleBase64}>
						导出 Base64
					</button>
				</div>
			</div>
			<div class="image-convert-preview">
				{previewUrl() && (
					<img src={previewUrl()} alt="" data-no-media-shell="true" />
				)}
			</div>
			<textarea
				class="tool-control tool-textarea compact code-text"
				readonly
				placeholder="导出的 Base64 会显示在这里"
				value={base64Output()}
			/>
			<canvas ref={canvas} hidden />
		</div>
	);
}
