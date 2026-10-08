/**
 * Direct Node http(s) client, anyfree2copilot-style.
 *
 * VS Code's extension-host `fetch` can buffer an SSE body until the
 * connection closes (and may send 127.0.0.1 through HTTP_PROXY). Copilot
 * then sits on "Thinking…" for the whole turn. Node's http module surfaces
 * headers immediately and yields chunks as they arrive, with keep-alive so
 * the next turn does not pay another TCP handshake.
 */

import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });

export interface HubHttpResponse {
	status: number;
	stream: IncomingMessage;
	text(): Promise<string>;
}

export function hubRequest(
	urlStr: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		timeoutMs?: number;
		signal?: AbortSignal;
	} = {},
): Promise<HubHttpResponse> {
	return new Promise((resolve, reject) => {
		let url: URL;
		try {
			url = new URL(urlStr);
		} catch (error) {
			reject(error);
			return;
		}
		const isTls = url.protocol === 'https:';
		const lib = isTls ? https : http;
		const headers: Record<string, string> = { ...(options.headers ?? {}), connection: 'keep-alive' };
		if (options.body !== undefined) {
			headers['content-length'] = String(Buffer.byteLength(options.body));
		}
		const req = lib.request({
			protocol: url.protocol,
			hostname: url.hostname,
			port: url.port || (isTls ? 443 : 80),
			path: `${url.pathname}${url.search}`,
			method: options.method ?? 'GET',
			headers,
			agent: isTls ? httpsAgent : httpAgent,
			family: url.hostname === '127.0.0.1' ? 4 : undefined,
		}, (incoming) => {
			resolve({
				status: incoming.statusCode ?? 0,
				stream: incoming,
				text: () => readText(incoming),
			});
		});
		req.setNoDelay(true);
		req.on('error', reject);
		if (typeof options.timeoutMs === 'number' && options.timeoutMs > 0) {
			req.setTimeout(options.timeoutMs, () => {
				req.destroy(new Error('hub request timed out'));
			});
		}
		const signal = options.signal;
		if (signal) {
			if (signal.aborted) {
				req.destroy(new Error('aborted'));
				return;
			}
			const onAbort = () => req.destroy(new Error('aborted'));
			signal.addEventListener('abort', onAbort, { once: true });
			req.on('close', () => signal.removeEventListener('abort', onAbort));
		}
		if (options.body !== undefined) req.write(options.body);
		req.end();
	});
}

async function readText(incoming: IncomingMessage): Promise<string> {
	const parts: Buffer[] = [];
	for await (const chunk of incoming) {
		parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(parts).toString('utf8');
}

export async function* chunksOf(incoming: IncomingMessage): AsyncIterable<Uint8Array> {
	for await (const chunk of incoming) {
		yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
	}
}
