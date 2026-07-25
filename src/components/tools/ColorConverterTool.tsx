import { createSignal } from "solid-js";

function parseColor(value: string): [number, number, number] {
	const input = value.trim();
	if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) {
		const hex =
			input.length === 4
				? `#${[...input.slice(1)].map((char) => char + char).join("")}`
				: input;
		return [
			Number.parseInt(hex.slice(1, 3), 16),
			Number.parseInt(hex.slice(3, 5), 16),
			Number.parseInt(hex.slice(5, 7), 16),
		];
	}
	const rgb = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	throw new Error("请输入 HEX 或 RGB");
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h *= 60;
	}
	return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

const clamp255 = (v: number) => Math.min(Math.max(v, 0), 255);

export default function ColorConverterTool() {
	const [colorInput, setColorInput] = createSignal("#2f6fe4");
	const [picker, setPicker] = createSignal("#2f6fe4");
	const [output, setOutput] = createSignal("");
	const [preview, setPreview] = createSignal("#2f6fe4");

	const updateColor = () => {
		try {
			const [r, g, b] = parseColor(colorInput());
			const hex = `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
			const hsl = rgbToHsl(r, g, b);
			setPicker(hex);
			setOutput(`${hex}\nrgb(${r}, ${g}, ${b})\nhsl(${hsl[0]} ${hsl[1]}% ${hsl[2]}%)`);
			setPreview(hex);
		} catch (error) {
			setOutput(error instanceof Error ? error.message : "颜色转换失败");
		}
	};

	const handlePickerInput = (value: string) => {
		setColorInput(value);
		setPicker(value);
		updateColor();
	};

	// initialize on mount
	updateColor();

	return (
		<div class="workspace color-compact">
			<div class="color-controls">
				<div class="color-swatch" style={{ background: preview() }} />
				<label>
					<span>取色</span>
					<input
						class="tool-control color-field"
						type="color"
						value={picker()}
						onInput={(e) => handlePickerInput(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span>颜色值</span>
					<input
						class="tool-control code-text"
						value={colorInput()}
						onInput={(e) => setColorInput(e.currentTarget.value)}
					/>
				</label>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={updateColor}>
						转换
					</button>
				</div>
			</div>
			<textarea class="tool-control tool-textarea compact code-text" readonly>
				{output()}
			</textarea>
		</div>
	);
}
