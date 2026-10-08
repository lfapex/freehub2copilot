import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hubRequest } from './http';
import { log } from './log';
import { HubSettings } from './settings';

const START_TIMEOUT_MS = 30_000;
const ALIVE_TTL_MS = 60_000;

let starting = false;
let lastAliveAt = 0;

export function isLocalHub(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname;
		return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
	} catch {
		return true;
	}
}

function readHubKeyFromDataDir(): string {
	const file = path.join(os.homedir(), '.free-model-hub', 'hub', 'settings.json');
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { server?: { key?: string } };
		const key = parsed?.server?.key;
		return typeof key === 'string' ? key : '';
	} catch {
		return '';
	}
}

async function probe(baseUrl: string, key: string): Promise<boolean> {
	if (key === '') return false;
	try {
		const response = await hubRequest(`${baseUrl}/hub-models`, {
			headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
			timeoutMs: 800,
			signal: AbortSignal.timeout(800),
		});
		response.stream.resume();
		if (response.status >= 200 && response.status < 300) {
			lastAliveAt = Date.now();
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * On the machine that runs the hub, start it from PATH when the OpenAI door
 * is dark. After spawn, re-read the key — first boot mints it into
 * settings.json, and an earlier empty read must not stick. Remote hubs and
 * explicitly configured apiKey/baseUrl pairs are left alone.
 */
export async function ensureDaemon(): Promise<void> {
	if (HubSettings.keyFromFile() !== true) return;
	const baseUrl = HubSettings.baseUrl();
	if (!isLocalHub(baseUrl)) return;
	if (lastAliveAt > 0 && Date.now() - lastAliveAt < ALIVE_TTL_MS) return;
	if (await probe(baseUrl, HubSettings.endpoint().key)) return;
	if (starting) {
		for (let waited = 0; waited < START_TIMEOUT_MS; waited += 500) {
			await sleep(500);
			if (await probe(baseUrl, HubSettings.endpoint().key)) return;
		}
		throw new Error('the hub daemon did not come up in time');
	}
	starting = true;
	try {
		const child = spawn('free-model-hub', [], {
			detached: true,
			stdio: 'ignore',
			shell: process.platform === 'win32',
			windowsHide: true,
			env: process.env,
		});
		child.on('error', (error) => {
			starting = false;
			log.warn('daemon', `could not spawn free-model-hub: ${error.message}`);
		});
		child.unref?.();
		log.info('daemon', 'hub not running — starting free-model-hub from PATH (detached)');
		for (let waited = 0; waited < START_TIMEOUT_MS; waited += 500) {
			await sleep(500);
			const key = readHubKeyFromDataDir() || HubSettings.endpoint().key;
			if (await probe(baseUrl, key)) {
				log.info('daemon', 'hub daemon is up');
				return;
			}
		}
		throw new Error(
			'the hub daemon was started but never answered — install it with `npm i -g github:lfapex/free-model-hub`, or start it manually',
		);
	} finally {
		starting = false;
	}
}

export function markHubAlive(): void {
	lastAliveAt = Date.now();
}
