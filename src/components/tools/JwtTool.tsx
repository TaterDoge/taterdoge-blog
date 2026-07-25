import { createSignal } from "solid-js";
import { base64UrlToJson, bytesToBase64Url, copyText } from "./shared";

interface JwtHeader {
	alg?: string;
	typ?: string;
	[key: string]: unknown;
}

interface JwtPayload {
	exp?: number;
	iat?: number;
	[key: string]: unknown;
}

function describeJwt(payload: JwtPayload): string {
	const now = Math.floor(Date.now() / 1000);
	const parts: string[] = [];
	if (typeof payload.exp === "number") {
		const date = new Date(payload.exp * 1000).toLocaleString("zh-CN");
		parts.push(payload.exp < now ? `已过期：${date}` : `过期时间：${date}`);
	}
	if (typeof payload.iat === "number")
		parts.push(`签发时间：${new Date(payload.iat * 1000).toLocaleString("zh-CN")}`);
	return parts.join(" / ") || "已解码";
}

export default function JwtTool() {
	const [token, setToken] = createSignal("");
	const [secret, setSecret] = createSignal("");
	const [header, setHeader] = createSignal("");
	const [payload, setPayload] = createSignal("");
	const [meta, setMeta] = createSignal("等待解码");
	const [metaState, setMetaState] = createSignal<"ok" | "error">("ok");

	const requireSubtleCrypto = () => {
		const crypto = globalThis.crypto;
		if (!crypto?.subtle)
			throw new Error("当前地址不支持 Web Crypto，请用 localhost 或 HTTPS 打开后再计算。");
		return crypto.subtle;
	};

	const decodeJwt = (): {
		token: string;
		parts: string[];
		header: JwtHeader;
		payload: JwtPayload;
	} => {
		const raw = token().trim();
		const parts = raw.split(".");
		if (parts.length !== 3) throw new Error("JWT 需要包含三段内容");
		const hdr = base64UrlToJson(parts[0]) as JwtHeader;
		const pld = base64UrlToJson(parts[1]) as JwtPayload;
		setHeader(JSON.stringify(hdr, null, 2));
		setPayload(JSON.stringify(pld, null, 2));
		setMeta(describeJwt(pld));
		setMetaState("ok");
		return { token: raw, parts, header: hdr, payload: pld };
	};

	const handleDecode = () => {
		try {
			decodeJwt();
		} catch (error) {
			setMeta(error instanceof Error ? error.message : "JWT 解码失败");
			setMetaState("error");
		}
	};

	const handleVerify = async () => {
		try {
			const decoded = decodeJwt();
			const alg = decoded.header.alg;
			const hash =
				alg === "HS256"
					? "SHA-256"
					: alg === "HS384"
						? "SHA-384"
						: alg === "HS512"
							? "SHA-512"
							: "";
			if (!hash) throw new Error("当前只支持 HS256 / HS384 / HS512");
			const sec = secret();
			if (!sec) throw new Error("请输入 HMAC Secret");
			const subtle = requireSubtleCrypto();
			const key = await subtle.importKey(
				"raw",
				new TextEncoder().encode(sec),
				{ name: "HMAC", hash },
				false,
				["sign"],
			);
			const signature = await subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(`${decoded.parts[0]}.${decoded.parts[1]}`),
			);
			const valid = bytesToBase64Url(signature) === decoded.parts[2];
			setMeta(`${describeJwt(decoded.payload)} / 签名${valid ? "有效" : "无效"}`);
			setMetaState(valid ? "ok" : "error");
		} catch (error) {
			setMeta(error instanceof Error ? error.message : "JWT 验证失败");
			setMetaState("error");
		}
	};

	const handleCopyPayload = async () => {
		if (payload()) await copyText(payload());
	};

	return (
		<div class="workspace jwt-grid">
			<label class="wide">
				<span>JWT</span>
				<textarea
					class="tool-control tool-textarea compact code-text"
					spellcheck="false"
					value={token()}
					onInput={(e) => setToken(e.currentTarget.value)}
				/>
			</label>
			<label>
				<span>HMAC Secret</span>
				<input
					class="tool-control code-text"
					placeholder="可选"
					value={secret()}
					onInput={(e) => setSecret(e.currentTarget.value)}
				/>
			</label>
			<output class="tool-result" data-state={metaState()}>
				{meta()}
			</output>
			<label>
				<span>Header</span>
				<textarea class="tool-control tool-textarea compact code-text" readonly>
					{header()}
				</textarea>
			</label>
			<label>
				<span>Payload</span>
				<textarea class="tool-control tool-textarea compact code-text" readonly>
					{payload()}
				</textarea>
			</label>
			<div class="panel-actions wide">
				<button class="tool-button primary" type="button" onClick={handleDecode}>
					解码
				</button>
				<button class="tool-button" type="button" onClick={handleVerify}>
					验证签名
				</button>
				<button class="tool-button" type="button" onClick={handleCopyPayload}>
					复制 Payload
				</button>
			</div>
		</div>
	);
}
