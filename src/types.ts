/** Wire format and picker metadata types for the hub-backed BYOK provider. */

// ── the hub's model row (/v1/models) ─────────────────────────────────────────

export interface HubModel {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutput?: number;
	vision?: boolean;
}

// ── OpenAI chat-completions wire format (hub ⇄ upstream) ─────────────────────

export interface ChatTextPart {
	type: 'text';
	text: string;
}

export interface ChatImageUrlPart {
	type: 'image_url';
	image_url: { url: string };
}

export type ChatContentPart = ChatTextPart | ChatImageUrlPart;

export interface ChatToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | ChatContentPart[];
	tool_call_id?: string;
	tool_calls?: ChatToolCall[];
}

export interface ChatTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}
