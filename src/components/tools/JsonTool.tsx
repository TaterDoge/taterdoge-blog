import { DualEditorTool, type ToolAction } from "./shared";

export default function JsonTool(props: { defaultValue: string }) {
	const actions: ToolAction[] = [
		{
			label: "格式化",
			primary: true,
			run: ({ input }) => {
				try {
					return {
						output: JSON.stringify(JSON.parse(input), null, 2),
						message: "JSON 已格式化",
					};
				} catch {
					return { message: "JSON 解析失败", error: true };
				}
			},
		},
		{
			label: "压缩",
			run: ({ input }) => {
				try {
					return {
						output: JSON.stringify(JSON.parse(input)),
						message: "JSON 已压缩",
					};
				} catch {
					return { message: "JSON 解析失败", error: true };
				}
			},
		},
	];

	return (
		<DualEditorTool
			defaultValue={props.defaultValue}
			inputLabel="输入"
			outputLabel="输出"
			actions={actions}
		/>
	);
}
