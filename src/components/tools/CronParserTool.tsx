import { createSignal, For } from "solid-js";

const cronMonthAliases: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
	jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const cronWeekdayAliases: Record<string, number> = {
	sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function formatCronDate(date: Date): string {
	return date.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatCronDelta(date: Date): string {
	const diff = Math.max(0, date.getTime() - Date.now());
	const days = Math.floor(diff / 86400000);
	const hours = Math.floor((diff % 86400000) / 3600000);
	const minutes = Math.ceil((diff % 3600000) / 60000);
	if (days > 0) return `${days} 天 ${hours} 小时后`;
	if (hours > 0) return `${hours} 小时 ${minutes} 分钟后`;
	return `${minutes || 1} 分钟后`;
}

function normalizeCronToken(value: string, aliases: Record<string, number> = {}): number {
	const lower = value.trim().toLowerCase();
	return  Object.hasOwn(aliases, lower) ? aliases[lower] : Number(lower);
}

function parseCronField(field: string, min: number, max: number, aliases: Record<string, number> = {}): number[] {
	const values = new Set<number>();
	const normalizedField = field.trim().replace(/\?/g, "*");
	if (!normalizedField) throw new Error("Cron 字段不能为空");
	normalizedField.split(",").forEach((part) => {
		const [rangePart, stepPart] = part.trim().split("/");
		const step = Math.max(1, Number.parseInt(stepPart || "1", 10) || 1);
		const range =
			rangePart === "*"
				? [min, max]
				: rangePart.includes("-")
					? rangePart.split("-").map((item) => normalizeCronToken(item, aliases))
					: [normalizeCronToken(rangePart, aliases), normalizeCronToken(rangePart, aliases)];
		if (!range.every(Number.isFinite)) throw new Error(`无效字段：${field}`);
		if (range[0] > range[1]) throw new Error(`范围起点不能大于终点：${field}`);
		for (let value = Math.max(min, range[0]); value <= Math.min(max, range[1]); value += step)
			values.add(value);
	});
	return [...values].sort((a, b) => a - b);
}

function describeCronField(raw: string, values: number[], unit: string, everyLabel = "每"): string {
	const value = raw.trim();
	if (value === "*" || value === "?") return `${everyLabel}${unit}`;
	if (/^\*\/\d+$/.test(value)) return `每 ${value.slice(2)} ${unit}`;
	if (values.length <= 6) return `${unit} ${values.join("、")}`;
	return `${unit} ${values[0]}-${values[values.length - 1]} 等 ${values.length} 个值`;
}

const TEMPLATES = [
	{ label: "每 5 分钟", value: "*/5 * * * *" },
	{ label: "每小时整点", value: "0 * * * *" },
	{ label: "工作日 9 点", value: "0 9 * * 1-5" },
	{ label: "每周一 8:30", value: "30 8 * * 1" },
	{ label: "每月 1 号", value: "0 0 1 * *" },
];

interface CronTimeItem {
	order: string;
	time: string;
	delta: string;
}

export default function CronParserTool() {
	const [expression, setExpression] = createSignal("*/15 9-18 * * 1-5");
	const [minute, setMinute] = createSignal("*/15");
	const [hour, setHour] = createSignal("9-18");
	const [day, setDay] = createSignal("*");
	const [month, setMonth] = createSignal("*");
	const [weekday, setWeekday] = createSignal("1-5");
	const [description, setDescription] = createSignal("等待解析");
	const [descState, setDescState] = createSignal<"ok" | "error">("ok");
	const [next, setNext] = createSignal("等待下次执行时间");
	const [nextState, setNextState] = createSignal<"ok" | "error">("ok");
	const [times, setTimes] = createSignal<CronTimeItem[]>([]);

	const updateFields = (expr: string) => {
		const parts = expr.trim().split(/\s+/);
		if (parts.length !== 5) throw new Error("请输入 5 段 cron 表达式");
		setMinute(parts[0]);
		setHour(parts[1]);
		setDay(parts[2]);
		setMonth(parts[3]);
		setWeekday(parts[4]);
	};

	const parseCron = () => {
		try {
			const expr = expression().trim();
			updateFields(expr);
			const [m, h, d, mo, w] = expr.split(/\s+/);
			const minutes = parseCronField(m, 0, 59);
			const hours = parseCronField(h, 0, 23);
			const days = parseCronField(d, 1, 31);
			const months = parseCronField(mo, 1, 12, cronMonthAliases);
			const weekdays = parseCronField(w, 0, 7, cronWeekdayAliases).map((v) => (v === 7 ? 0 : v));
			const results: Date[] = [];
			const cursor = new Date(Date.now() + 60000);
			cursor.setSeconds(0, 0);
			for (let guard = 0; guard < 525600 && results.length < 8; guard += 1) {
				if (
					minutes.includes(cursor.getMinutes()) &&
					hours.includes(cursor.getHours()) &&
					days.includes(cursor.getDate()) &&
					months.includes(cursor.getMonth() + 1) &&
					weekdays.includes(cursor.getDay())
				) {
					results.push(new Date(cursor));
				}
				cursor.setMinutes(cursor.getMinutes() + 1);
			}
			const summary = [
				`表达式：${expr}`,
				describeCronField(m, minutes, "分钟"),
				describeCronField(h, hours, "小时"),
				describeCronField(d, days, "日期"),
				describeCronField(mo, months, "月份"),
				describeCronField(w, [...new Set(weekdays)].sort((a, b) => a - b), "星期"),
			].join("\n");
			setDescription(summary);
			setDescState("ok");
			setNext(
				results[0]
					? `下次执行：${formatCronDate(results[0])}\n${formatCronDelta(results[0])}`
					: "未来一年内没有匹配时间",
			);
			setNextState(results[0] ? "ok" : "error");
			setTimes(
				results.map((date, index) => ({
					order: `#${index + 1}`,
					time: formatCronDate(date),
					delta: formatCronDelta(date),
				})),
			);
		} catch (error) {
			setDescription(error instanceof Error ? error.message : "解析失败");
			setDescState("error");
			setNext("无法计算下次执行时间");
			setNextState("error");
			setTimes([]);
		}
	};

	const compose = () => {
		const parts = [minute(), hour(), day(), month(), weekday()].map(
			(v) => v.trim() || "*",
		);
		setExpression(parts.join(" "));
		parseCron();
	};

	const applyTemplate = (value: string) => {
		setExpression(value);
		parseCron();
	};

	return (
		<div class="workspace cron-workspace">
			<div class="cron-expression-card">
				<label>
					<span>表达式</span>
					<input
						class="tool-control code-text"
						value={expression()}
						onInput={(e) => setExpression(e.currentTarget.value)}
					/>
				</label>
				<div class="panel-actions">
					<button class="tool-button primary" type="button" onClick={parseCron}>
						解析表达式
					</button>
				</div>
			</div>

			<div class="chip-row cron-presets">
				<For each={TEMPLATES}>
					{(tpl) => (
						<button class="chip" type="button" onClick={() => applyTemplate(tpl.value)}>
							{tpl.label}
						</button>
					)}
				</For>
			</div>

			<div class="cron-field-grid">
				<label><span>分钟 <small>0-59</small></span><input class="tool-control code-text" value={minute()} onInput={(e) => setMinute(e.currentTarget.value)} /></label>
				<label><span>小时 <small>0-23</small></span><input class="tool-control code-text" value={hour()} onInput={(e) => setHour(e.currentTarget.value)} /></label>
				<label><span>日期 <small>1-31</small></span><input class="tool-control code-text" value={day()} onInput={(e) => setDay(e.currentTarget.value)} /></label>
				<label><span>月份 <small>1-12</small></span><input class="tool-control code-text" value={month()} onInput={(e) => setMonth(e.currentTarget.value)} /></label>
				<label><span>星期 <small>0-7</small></span><input class="tool-control code-text" value={weekday()} onInput={(e) => setWeekday(e.currentTarget.value)} /></label>
			</div>

			<div class="panel-actions">
				<button class="tool-button" type="button" onClick={compose}>
					从字段生成表达式
				</button>
			</div>

			<div class="cron-summary-grid">
				<output class="tool-result cron-summary" data-state={descState()}>
					{description()}
				</output>
				<output class="tool-result cron-next" data-state={nextState()}>
					{next()}
				</output>
			</div>

			<div class="cron-time-list">
				<For each={times()}>
					{(item) => (
						<div class="cron-time-row">
							<span>{item.order}</span>
							<strong>{item.time}</strong>
							<em>{item.delta}</em>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
