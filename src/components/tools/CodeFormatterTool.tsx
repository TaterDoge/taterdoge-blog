import { createSignal } from "solid-js";
import { format as formatSql } from "sql-formatter";
import * as prettier from "prettier/standalone";
import * as parserBabel from "prettier/plugins/babel";
import * as parserEstree from "prettier/plugins/estree";
import * as parserTypescript from "prettier/plugins/typescript";
import * as parserYaml from "prettier/plugins/yaml";
import { clamp, copyText } from "./shared";

type FormatLang = "typescript" | "babel" | "json" | "yaml" | "sql";

export default function CodeFormatterTool() {
	const [lang, setLang] = createSignal<FormatLang>("typescript");
	const [tab, setTab] = createSignal("2");
	const [input, setInput] = createSignal(
		"const hello=(name:string)=>{return {name,ok:true}}",
	);
	const [output, setOutput] = createSignal("");
	const [status, setStatus] = createSignal("等待输入");
	const [statusState, setStatusState] = createSignal<"ok" | "error">("ok");

	const handleFormat = async () => {
		try {
			const tw = clamp(Number.parseInt(tab(), 10) || 2, 2, 8);
			const text = input();
			const parser =
				lang() === "json"
					? "json"
					: lang() === "yaml"
						? "yaml"
						: lang() === "babel"
							? "babel"
							: lang() === "typescript"
								? "typescript"
								: "";
			const formatted =
				lang() === "sql"
					? formatSql(text, { language: "sql", tabWidth: tw })
					: await prettier.format(text, {
							parser,
							plugins: [
								parserBabel,
								parserTypescript,
								parserEstree,
								parserYaml,
							],
							tabWidth: tw,
							semi: true,
						});
			setOutput(formatted.trimEnd());
			setStatus("格式化完成");
			setStatusState("ok");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "格式化失败");
			setStatusState("error");
		}
	};

	const handleCopy = async () => {
		if (output()) await copyText(output());
	};

	return (
		<div class="workspace formatter-grid">
			<label>
				<span>语言</span>
				<select
					class="tool-control"
					value={lang()}
					onChange={(e) =>
						setLang(e.currentTarget.value as FormatLang)
					}
				>
					<option value="typescript">TypeScript</option>
					<option value="babel">JavaScript</option>
					<option value="json">JSON</option>
					<option value="yaml">YAML</option>
					<option value="sql">SQL</option>
				</select>
			</label>
			<label>
				<span>缩进</span>
				<input
					class="tool-control code-text"
					value={tab()}
					inputmode="numeric"
					onInput={(e) => setTab(e.currentTarget.value)}
				/>
			</label>
			<label class="wide">
				<span>输入</span>
				<textarea
					class="tool-control tool-textarea code-text"
					spellcheck="false"
					value={input()}
					onInput={(e) => setInput(e.currentTarget.value)}
				/>
			</label>
			<label class="wide">
				<span>输出</span>
				<textarea class="tool-control tool-textarea code-text" readonly>
					{output()}
				</textarea>
			</label>
			<div class="tool-footer wide">
				<p class="tool-status" data-state={statusState()}>
					{status()}
				</p>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={handleFormat}>
						格式化
					</button>
					<button class="tool-button" type="button" onClick={handleCopy}>
						复制
					</button>
				</div>
			</div>
		</div>
	);
}
