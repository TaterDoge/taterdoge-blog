import { DualEditorTool, type ToolAction } from "./shared";

export default function UrlTool(props: { defaultValue: string }) {
	const actions: ToolAction[] = [
		{
			label: "编码",
			primary: true,
			run: ({ input }) => ({
				output: encodeURIComponent(input),
				message: "URL 已编码",
			}),
		},
		{
			label: "解码",
			run: ({ input }) => {
				try {
					return {
						output: decodeURIComponent(input),
						message: "URL 已解码",
					};
				} catch {
					return { message: "URL 解码失败", error: true };
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
