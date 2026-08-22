import {
	utf8ToBase64,
	base64ToUtf8,
	DualEditorTool,
	type ToolAction,
} from "./shared";

export default function Base64Tool(props: { defaultValue: string }) {
	const actions: ToolAction[] = [
		{
			label: "明文 → Base64",
			primary: true,
			run: ({ input }) => ({
				output: utf8ToBase64(input),
				message: "已从左侧明文编码到右侧 Base64",
			}),
		},
		{
			label: "Base64 → 明文",
			run: ({ output }) => {
				try {
					return {
						input: base64ToUtf8(output.trim()),
						message: "已从右侧 Base64 解码到左侧明文",
					};
				} catch {
					return { message: "Base64 解码失败", error: true };
				}
			},
		},
	];

	return (
		<DualEditorTool
			defaultValue={props.defaultValue}
			inputLabel="明文"
			outputLabel="Base64 密文"
			outputEditable
			actions={actions}
		/>
	);
}
