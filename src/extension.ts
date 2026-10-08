import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vscode from 'vscode';

import { convertToChatRequest } from './convert';
import { ensureDaemon } from './daemon';
import { log } from './log';
import { HubSettings } from './settings';
import type { HubModel } from './types';

/**
 * Free Model Hub for Copilot — a BYOK language-model provider backed by the
 * free-model-hub daemon.
 *
 * The mechanism is anyfree2copilot's: `vscode.lm.registerLanguageModelChatProvider`
 * plugs into the same provider API Copilot Chat itself uses, so the hub's
 * whole roster — the anonymous free lane, Kilo, the 13 account channels, the
 * user's relays — appears as one picker section with agent mode, tool calling
 * and MCP intact. No local gateway to point Copilot at by hand: on the
 * machine that runs the hub the server key is read straight from the hub's
 * data directory, so the extension is zero-configuration there.
 */

type PickerInfo = vscode.LanguageModelChatInformation & {
	isBYOK?: boolean;
	isUserSelectable?: boolean;
};

const VENDOR = 'freehub';
const REQUEST_TIMEOUT_MS = 600000;

export function activate(context: vscode.ExtensionContext): void {
	const channel = vscode.window.createOutputChannel('Free Model Hub for Copilot');
	log.init(channel, HubSettings.debug());
	context.subscriptions.push(channel);

	const onChanged = new vscode.EventEmitter<void>();
	context.subscriptions.push(onChanged);

	const state: { models: HubModel[] } = { models: [] };

	const refresh = async (force = false): Promise<void> => {
		try {
			await ensureDaemon();
			const models = await fetchModelList(HubSettings.endpoint(), force);
			const changed = JSON.stringify(models) !== JSON.stringify(state.models);
			state.models = models;
			log.info('catalog', `${models.length} models advertised by the hub`);
			if (changed || force) onChanged.fire();
		} catch (error) {
			// A down daemon must not empty the picker: keep the last roster and
			// say why, exactly once per state change.
			log.warn('catalog', `hub unreachable at ${HubSettings.baseUrl()}: ${(error as Error).message} — keeping the last catalog (${state.models.length} models)`);
		}
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('freehub')) {
				log.debugLog('extension', 'settings changed — reconnecting');
				log.init(channel, HubSettings.debug());
				onChanged.fire();
				void refresh(true);
			}
		}),
		vscode.commands.registerCommand('freehub.showStatus', () => showStatus(state)),
		vscode.commands.registerCommand('freehub.refreshModels', () => {
			void refresh(true).then(() => {
				void vscode.window.showInformationMessage(`Free Model Hub: catalog refreshed — ${state.models.length} models`);
			});
		}),
		vscode.commands.registerCommand('freehub.showLogs', () => log.show()),
		vscode.lm.registerLanguageModelChatProvider(VENDOR, {
			onDidChangeLanguageModelChatInformation: onChanged.event,

			async provideLanguageModelChatInformation(
				_options: vscode.PrepareLanguageModelChatModelOptions,
				_token: vscode.CancellationToken,
			): Promise<vscode.LanguageModelChatInformation[]> {
				// Advertise the cached roster immediately; refresh in the
				// background so the picker populates without blocking.
				void refresh();
				return state.models.map(toChatInfo) as unknown as vscode.LanguageModelChatInformation[];
			},

			async provideLanguageModelChatResponse(
				modelInfo: vscode.LanguageModelChatInformation,
				messages: readonly vscode.LanguageModelChatRequestMessage[],
				options: vscode.ProvideLanguageModelChatResponseOptions,
				progress: vscode.Progress<vscode.LanguageModelResponsePart>,
				token: vscode.CancellationToken,
			): Promise<void> {
				const model = state.models.find((candidate) => candidate.id === modelInfo.id)
					?? { id: modelInfo.id, vision: false };
				await runChatCompletion(model, messages, options, progress, token);
			},

			async provideTokenCount(
				_modelInfo: vscode.LanguageModelChatInformation,
				text: string | vscode.LanguageModelChatRequestMessage,
				_token: vscode.CancellationToken,
			): Promise<number> {
				return estimateTokenCount(text);
			},
		}),
	);

	// Populate without waiting for Copilot, which may itself wait for the BYOK
	// registration; then once more after Copilot Chat is up.
	void refresh(true);
	context.subscriptions.push(onChanged);
	void Promise.resolve(vscode.extensions.getExtension('github.copilot-chat')?.activate())
		.then(() => onChanged.fire())
		.catch((error) => log.warn('extension', `copilot-chat activation refresh failed: ${(error as Error).message}`));

	const timer = setInterval(() => void refresh(), Math.max(60, HubSettings.refreshSeconds()) * 1000);
	timer.unref?.();
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function toChatInfo(model: HubModel): PickerInfo {
	return {
		id: model.id,
		name: model.name ?? model.id,
		family: 'free-model-hub',
		version: '1.0.0',
		detail: `free · via free-model-hub`,
		tooltip: `${model.id} — served by the free-model-hub daemon${model.efforts?.length ? ` · efforts ${model.efforts.join('/')}` : ''}`,
		maxInputTokens: model.contextWindow ?? 131_072,
		maxOutputTokens: model.maxOutput ?? 32_768,
		isBYOK: true,
		isUserSelectable: true,
		capabilities: {
			toolCalling: true,
			imageInput: model.vision === true,
		},
	};
}

// ── the hub client ───────────────────────────────────────────────────────────

async function fetchModelList(endpoint: { baseUrl: string; key: string }, _force = false): Promise<HubModel[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15000);
	timer.unref?.();
	try {
		const hubModels = await fetch(`${endpoint.baseUrl}/hub-models`, {
			headers: hubHeaders(endpoint.key),
			cache: 'no-store',
			signal: controller.signal,
		});
		if (hubModels.ok) {
			const payload = (await hubModels.json()) as { models?: Array<Record<string, unknown>> };
			return (payload.models ?? []).map(rowToHubModel).filter((model) => model.id !== '');
		}
		if (hubModels.status === 401) throw new Error('the hub rejected the API key (settings: freehub.apiKey, or the hub data directory moved)');
		const response = await fetch(`${endpoint.baseUrl}/v1/models`, {
			headers: hubHeaders(endpoint.key),
			cache: 'no-store',
			signal: controller.signal,
		});
		if (response.status === 401) throw new Error('the hub rejected the API key (settings: freehub.apiKey, or the hub data directory moved)');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
		return (payload.data ?? []).map(rowToHubModel).filter((model) => model.id !== '');
	} finally {
		clearTimeout(timer);
	}
}

function rowToHubModel(row: Record<string, unknown>): HubModel {
	const efforts = Array.isArray(row.efforts) ? row.efforts.filter((value): value is string => typeof value === 'string') : undefined;
	return {
		id: String(row.id ?? ''),
		name: typeof row.name === 'string' ? row.name : undefined,
		contextWindow: typeof row.context_window === 'number' ? row.context_window : typeof row.contextWindow === 'number' ? row.contextWindow : undefined,
		maxOutput: typeof row.max_output === 'number' ? row.max_output : typeof row.maxOutput === 'number' ? row.maxOutput : undefined,
		vision: row.vision === true,
		efforts: efforts && efforts.length > 0 ? efforts : undefined,
		effortDefault: typeof row.effort_default === 'string' ? row.effort_default : typeof row.effortDefault === 'string' ? row.effortDefault : undefined,
	};
}

/** Authorization header for the hub; a missing key means a missing hub install. */
function hubHeaders(key: string): Record<string, string> {
	const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
	if (key !== '') headers.authorization = `Bearer ${key}`;
	return headers;
}

/**
 * One turn: VS Code chat messages → hub `/v1/chat/completions` (SSE) →
 * Copilot response parts. Thinking output rides the hub's `reasoning` delta
 * field, surfaced through the proposed ThinkingPart API when present.
 */
async function runChatCompletion(
	model: HubModel,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: vscode.ProvideLanguageModelChatResponseOptions,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
): Promise<void> {
	const endpoint = HubSettings.endpoint();
	if (endpoint.key === '') {
		throw new Error(
			'no hub API key — start the free-model-hub daemon once (node index.js in the hub checkout); '
			+ 'the key is read from ~/.free-model-hub/hub/settings.json automatically, '
			+ 'or set it under freehub.apiKey',
		);
	}
	const body = convertToChatRequest(model, messages, options);
	const controller = new AbortController();
	const cancelListener = token.onCancellationRequested(() => controller.abort());
	const timeout = setTimeout(() => controller.abort(new Error('hub request timed out')), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${endpoint.baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: hubHeaders(endpoint.key),
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			let message = text.slice(0, 400) || `HTTP ${response.status}`;
			try { message = (JSON.parse(text) as { error?: { message?: string } })?.error?.message ?? message; } catch { /* plain text */ }
			throw new Error(`hub request failed: ${message}`);
		}
		if (!response.body) throw new Error('hub response has no body');
		await streamResponse(response.body, progress, token);
	} finally {
		cancelListener.dispose();
		clearTimeout(timeout);
	}
}

interface PendingToolCall {
	id: string;
	name: string;
	arguments: string;
}

async function streamResponse(
	upstream: ReadableStream<Uint8Array>,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
): Promise<void> {
	const decoder = new TextDecoder();
	const pendingToolCalls = new Map<number, PendingToolCall>();
	let finishSeen = false;

	const flushToolCalls = () => {
		for (const call of [...pendingToolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, slot]) => slot)) {
			let input: unknown = {};
			try { input = JSON.parse(call.arguments || '{}'); } catch { input = {}; }
			progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, input as Record<string, unknown>));
		}
		pendingToolCalls.clear();
	};

	let buffer = '';
	for await (const raw of upstream) {
		if (token.isCancellationRequested) return;
		buffer += decoder.decode(raw, { stream: true });
		let index: number;
		while ((index = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, index).replace(/\r$/, '');
			buffer = buffer.slice(index + 1);
			if (line === '' || line.startsWith(':')) continue;
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '[DONE]') { flushToolCalls(); return; }
			let chunk: {
				choices?: Array<{
					delta?: {
						content?: string | null;
						reasoning?: string | null;
						reasoning_content?: string | null;
						tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
					};
					finish_reason?: string | null;
				}>;
				error?: { message?: string };
				usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
			};
			try { chunk = JSON.parse(data); } catch { continue; }
			if (chunk.error !== undefined) {
				throw new Error(`hub stream error: ${chunk.error?.message ?? 'unknown'}`);
			}
			for (const choice of chunk.choices ?? []) {
				const delta = choice.delta ?? {};
				if (typeof delta.content === 'string' && delta.content.length > 0) {
					progress.report(new vscode.LanguageModelTextPart(delta.content));
				}
				const thinking = delta.reasoning ?? delta.reasoning_content;
				if (typeof thinking === 'string' && thinking.length > 0) {
					emitThinking(thinking, progress);
				}
				if (Array.isArray(delta.tool_calls)) {
					for (const call of delta.tool_calls) {
						const slotIndex = call.index ?? 0;
						const slot = pendingToolCalls.get(slotIndex) ?? { id: '', name: '', arguments: '' };
						if (call.id) slot.id = call.id;
						if (call.function?.name) {
							// Providers that repeat the whole name each delta must not concatenate.
							const incoming = call.function.name;
							slot.name = slot.name && !incoming.startsWith(slot.name) ? slot.name + incoming : incoming;
						}
						if (call.function?.arguments) slot.arguments += call.function.arguments;
						pendingToolCalls.set(slotIndex, slot);
					}
				}
				if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
					finishSeen = true;
					flushToolCalls();
				}
			}
			if (chunk.usage !== undefined) reportUsage(chunk.usage, progress);
		}
	}
	// Stream ended without [DONE]/finish_reason — flush anything accumulated.
	if (!finishSeen) flushToolCalls();
}

function emitThinking(text: string, progress: vscode.Progress<vscode.LanguageModelResponsePart>): void {
	if (typeof vscode.LanguageModelThinkingPart !== 'function') return;
	try {
		progress.report(new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart);
	} catch {
		// Runtime without the proposed API — drop thinking output silently.
	}
}

function reportUsage(
	usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens ?? 0,
		completion_tokens: usage.completion_tokens ?? 0,
		total_tokens: usage.total_tokens ?? 0,
	};
	try {
		progress.report(
			new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(data)), 'application/vnd.copilot.chat.usage') as unknown as vscode.LanguageModelResponsePart,
		);
	} catch {
		// Usage reporting is best effort; the chat works without it.
	}
}

function estimateTokenCount(text: string | vscode.LanguageModelChatRequestMessage): number {
	let chars = 0;
	if (typeof text === 'string') {
		chars = text.length;
	} else {
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				chars += part.value.length;
			} else if (typeof vscode.LanguageModelToolCallPart === 'function' && part instanceof vscode.LanguageModelToolCallPart) {
				chars += part.name.length + JSON.stringify(part.input ?? {}).length;
			}
		}
	}
	return Math.max(1, Math.ceil(chars / 4));
}

function showStatus(state: { models: HubModel[] }): void {
	const endpoint = HubSettings.endpoint();
	void vscode.window.showQuickPick(
		[
			{ label: `hub: ${endpoint.baseUrl}`, description: endpoint.key === '' ? 'no API key — daemon not started or data directory moved' : 'API key resolved' },
			{ label: `${state.models.length} models`, description: 'advertised to Copilot Chat' },
			...state.models.slice(0, 30).map((model) => ({ label: model.id, description: model.name })),
		],
		{ placeHolder: 'Free Model Hub connection status' },
	);
}

export function deactivate(): void {
	// Everything is registered on the extension context.
}

// Re-exported for the smoke test.
export { readHubKeyFromDataDir };

/**
 * The zero-configuration path: on the machine that runs the hub, the server
 * key lives in the hub's own settings file. Read it read-only, per connect.
 */
function readHubKeyFromDataDir(home?: string): string {
	const file = path.join(home ?? path.join(os.homedir(), '.free-model-hub'), 'hub', 'settings.json');
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { server?: { key?: string } };
		const key = parsed?.server?.key;
		return typeof key === 'string' ? key : '';
	} catch {
		return '';
	}
}
