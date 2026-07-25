import { createSignal, For } from "solid-js";
import { diffChars, diffLines } from "diff";

interface DiffLine {
	number: string;
	text: string;
	pairText: string | null;
	side: "left" | "right";
	type: "same" | "removed" | "added" | "empty";
	changed: boolean;
}

interface DiffCharPart {
	value: string;
	added?: boolean;
	removed?: boolean;
}

function splitDiffLines(value: string): string[] {
	if (!value) return [];
	const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function buildDiffCodeParts(
	text: string,
	pairText: string | null,
	side: "left" | "right",
	changed: boolean,
): DiffCharPart[] {
	if (!changed || pairText === null) return [{ value: text || " " }];
	const parts = diffChars(side === "left" ? text : pairText, side === "left" ? pairText : text);
	const result: DiffCharPart[] = [];
	for (const part of parts) {
		if (side === "left" && part.added) continue;
		if (side === "right" && part.removed) continue;
		result.push({ value: part.value, added: part.added, removed: part.removed });
	}
	if (result.length === 0 || !result.some((p) => p.value)) return [{ value: " " }];
	return result;
}

export default function DiffTool() {
	const [leftText, setLeftText] = createSignal("hello\nold line\nsame");
	const [rightText, setRightText] = createSignal("hello\nnew line\nsame");
	const [status, setStatus] = createSignal("等待对比");
	const [leftLines, setLeftLines] = createSignal<DiffLine[]>([]);
	const [rightLines, setRightLines] = createSignal<DiffLine[]>([]);
	const [removedCount, setRemovedCount] = createSignal(0);
	const [addedCount, setAddedCount] = createSignal(0);

	const handleDiff = () => {
		const lt = leftText();
		const rt = rightText();
		const ll: DiffLine[] = [];
		const rl: DiffLine[] = [];
		let added = 0;
		let removed = 0;
		let leftLine = 1;
		let rightLine = 1;
		const parts = diffLines(lt, rt);

		const appendPair = (
			left: { number: number; text: string } | null,
			right: { number: number; text: string } | null,
			state: "same" | "changed" | "single",
		) => {
			ll.push({
				number: left ? String(left.number) : "",
				text: left?.text ?? "",
				pairText: right?.text ?? null,
				side: "left",
				type: left ? (state === "same" ? "same" : "removed") : "empty",
				changed: Boolean(left && right && state === "changed"),
			});
			rl.push({
				number: right ? String(right.number) : "",
				text: right?.text ?? "",
				pairText: left?.text ?? null,
				side: "right",
				type: right ? (state === "same" ? "same" : "added") : "empty",
				changed: Boolean(left && right && state === "changed"),
			});
		};

		for (let index = 0; index < parts.length; index += 1) {
			const part = parts[index];
			if (part.removed && parts[index + 1]?.added) {
				const removedLines = splitDiffLines(part.value);
				const addedLines = splitDiffLines(parts[index + 1].value);
				const length = Math.max(removedLines.length, addedLines.length);
				for (let i = 0; i < length; i += 1) {
					const left =
						removedLines[i] !== undefined
							? { number: leftLine++, text: removedLines[i] }
							: null;
					const right =
						addedLines[i] !== undefined
							? { number: rightLine++, text: addedLines[i] }
							: null;
					if (left) removed += 1;
					if (right) added += 1;
					appendPair(left, right, left && right ? "changed" : "single");
				}
				index += 1;
				continue;
			}
			const lines = splitDiffLines(part.value);
			for (const line of lines) {
				if (part.removed) {
					removed += 1;
					appendPair({ number: leftLine++, text: line }, null, "single");
				} else if (part.added) {
					added += 1;
					appendPair(null, { number: rightLine++, text: line }, "single");
				} else {
					appendPair(
						{ number: leftLine++, text: line },
						{ number: rightLine++, text: line },
						"same",
					);
				}
			}
		}
		setLeftLines(ll);
		setRightLines(rl);
		setRemovedCount(removed);
		setAddedCount(added);
		setStatus(`删除 ${removed} 行 / 添加 ${added} 行`);
	};

	return (
		<div class="workspace dual-editor">
			<label>
				<span>原文本</span>
				<textarea
					class="tool-control tool-textarea code-text"
					spellcheck="false"
					value={leftText()}
					onInput={(e) => setLeftText(e.currentTarget.value)}
				/>
			</label>
			<label>
				<span>新文本</span>
				<textarea
					class="tool-control tool-textarea code-text"
					spellcheck="false"
					value={rightText()}
					onInput={(e) => setRightText(e.currentTarget.value)}
				/>
			</label>
			<div class="tool-footer">
				<p class="tool-status">{status()}</p>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={handleDiff}>
						对比
					</button>
				</div>
			</div>
			<div class="diff-output wide">
				<section class="diff-pane removed">
					<div class="diff-pane-head">
						<strong>删除</strong>
						<span>{removedCount()} 行</span>
					</div>
					<div class="diff-pane-body">
						<For each={leftLines()}>
							{(line) => (
								<div class={`diff-line diff-${line.type}`}>
									<span class="diff-line-number">{line.number}</span>
									<span class="diff-code">
										<For each={buildDiffCodeParts(line.text, line.pairText, line.side, line.changed)}>
											{(part) => (
												<span class={part.removed ? "diff-char-remove" : part.added ? "diff-char-add" : ""}>
													{part.value}
												</span>
											)}
										</For>
									</span>
								</div>
							)}
						</For>
					</div>
				</section>
				<section class="diff-pane added">
					<div class="diff-pane-head">
						<strong>添加</strong>
						<span>{addedCount()} 行</span>
					</div>
					<div class="diff-pane-body">
						<For each={rightLines()}>
							{(line) => (
								<div class={`diff-line diff-${line.type}`}>
									<span class="diff-line-number">{line.number}</span>
									<span class="diff-code">
										<For each={buildDiffCodeParts(line.text, line.pairText, line.side, line.changed)}>
											{(part) => (
												<span class={part.removed ? "diff-char-remove" : part.added ? "diff-char-add" : ""}>
													{part.value}
												</span>
											)}
										</For>
									</span>
								</div>
							)}
						</For>
					</div>
				</section>
			</div>
		</div>
	);
}
