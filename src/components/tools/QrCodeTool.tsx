import { createSignal, For } from "solid-js";
import QRCode from "qrcode";
import { clamp } from "./shared";

interface QrBatchItem {
	url: string;
	download: string;
	title: string;
	label: string;
}

export default function QrCodeTool() {
	const [input, setInput] = createSignal("https://marchen.dev");
	const [dark, setDark] = createSignal("#0f172a");
	const [light, setLight] = createSignal("#ffffff");
	const [size, setSize] = createSignal("220");
	const [status, setStatus] = createSignal("等待生成");
	const [statusState, setStatusState] = createSignal<"ok" | "error">("ok");
	const [firstUrl, setFirstUrl] = createSignal("");
	const [batch, setBatch] = createSignal<QrBatchItem[]>([]);

	const generate = async () => {
		const lines = input()
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const sz = clamp(Number.parseInt(size(), 10) || 220, 64, 2048);
		if (lines.length === 0) {
			setStatus("请输入文本或链接");
			setStatusState("error");
			return;
		}
		try {
			const d = dark() || "#0f172a";
			const l = light() || "#ffffff";
			const first = await QRCode.toDataURL(lines[0], {
				width: sz,
				margin: 2,
				color: { dark: d, light: l },
			});
			setFirstUrl(first);
			const rest: QrBatchItem[] = [];
			for (const [index, line] of lines.slice(1).entries()) {
				const url = await QRCode.toDataURL(line, {
					width: sz,
					margin: 1,
					color: { dark: d, light: l },
				});
				rest.push({
					url,
					download: `qrcode-${index + 2}.png`,
					title: line,
					label: `#${index + 2}`,
				});
			}
			setBatch(rest);
			setStatus(
				`已生成 ${lines.length} 个二维码 / 预览 128 × 128 / 下载 ${sz} × ${sz}px`,
			);
			setStatusState("ok");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "二维码生成失败");
			setStatusState("error");
		}
	};

	const download = async () => {
		const lines = input()
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length === 0) {
			setStatus("请输入文本或链接");
			setStatusState("error");
			return;
		}
		try {
			const sz = clamp(Number.parseInt(size(), 10) || 220, 64, 2048);
			const d = dark() || "#0f172a";
			const l = light() || "#ffffff";
			const canvas = document.createElement("canvas");
			await QRCode.toCanvas(canvas, lines[0], {
				width: sz,
				margin: 2,
				color: { dark: d, light: l },
			});
			const link = document.createElement("a");
			link.href = canvas.toDataURL("image/png");
			link.download = `qrcode-${sz}.png`;
			link.click();
			setStatus(`已下载 ${canvas.width} × ${canvas.height}px`);
			setStatusState("ok");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "二维码下载失败");
			setStatusState("error");
		}
	};

	const sz = () => clamp(Number.parseInt(size(), 10) || 220, 64, 2048);

	return (
		<div class="workspace qr-compact">
			<label class="qr-text">
				<span>文本 / 链接</span>
				<textarea
					class="tool-control tool-textarea compact code-text"
					spellcheck="false"
					value={input()}
					onInput={(e) => setInput(e.currentTarget.value)}
				/>
			</label>
			<div class="qr-controls">
				<label>
					<span>前景</span>
					<input
						class="tool-control color-field"
						type="color"
						value={dark()}
						onInput={(e) => setDark(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span>背景</span>
					<input
						class="tool-control color-field"
						type="color"
						value={light()}
						onInput={(e) => setLight(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span>尺寸</span>
					<input
						class="tool-control code-text"
						value={size()}
						min="64"
						max="2048"
						inputmode="numeric"
						onInput={(e) => setSize(e.currentTarget.value)}
					/>
				</label>
			</div>
			<div class="tool-footer">
				<p class="tool-status" data-state={statusState()}>
					{status()}
				</p>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={generate}>
						生成
					</button>
					<button class="tool-button" type="button" onClick={download}>
						下载首个
					</button>
				</div>
			</div>
			<div class="qr-result">
				<a
					class="qr-code-item qr-preview-box"
					href={firstUrl() || "#"}
					download={`qrcode-${sz()}-1.png`}
					title={input().split(/\r?\n/)[0]?.trim() || ""}
				>
					{firstUrl() && (
						<img
							class="qr-code-image"
							src={firstUrl()}
							alt=""
							data-no-media-shell="true"
							style={{ width: "128px", height: "128px" }}
						/>
					)}
					<span class="qr-batch-label">#1</span>
				</a>
				<div class="qr-batch">
					<For each={batch()}>
						{(item) => (
							<a
								class="qr-code-item qr-batch-item"
								href={item.url}
								download={item.download}
								title={item.title}
							>
								<img
									class="qr-code-image"
									src={item.url}
									alt=""
									data-no-media-shell="true"
									style={{ width: "128px", height: "128px" }}
								/>
								<span class="qr-batch-label">{item.label}</span>
							</a>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
