import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vscode from 'vscode';

/**
 * Settings access, cached per read: `freehub.*` values plus the
 * zero-configuration key resolution (the hub data directory's server key).
 */
class HubSettingsReader {
	#cache: { baseUrl: string; key: string; at: number } | undefined;

	/** Endpoint for API calls; the key auto-resolves from the hub data dir. */
	endpoint(): { baseUrl: string; key: string } {
		// Short cache: the config event already fires on change, this only
		// guards against reading the key file on every picker repaint.
		const cached = this.#cache;
		if (cached !== undefined && Date.now() - cached.at < 5000) return cached;
		const config = vscode.workspace.getConfiguration('freehub');
		const baseUrl = String(config.get('baseUrl') ?? 'http://127.0.0.1:8330').replace(/\/+$/, '');
		let key = String(config.get('apiKey') ?? '').trim();
		if (key === '') key = readHubKeyFromDataDir();
		const value = { baseUrl, key, at: Date.now() };
		this.#cache = value;
		return value;
	}

	baseUrl(): string {
		return this.endpoint().baseUrl;
	}

	refreshSeconds(): number {
		const value = Number(vscode.workspace.getConfiguration('freehub').get('refreshSeconds') ?? 300);
		return Number.isFinite(value) && value > 0 ? value : 300;
	}

	debug(): boolean {
		return vscode.workspace.getConfiguration('freehub').get('debug') === true;
	}
}

export const HubSettings = new HubSettingsReader();

/**
 * The zero-configuration path: on the machine that runs the hub, the server
 * key lives in the hub's own settings file. Read-only, tolerant of absence —
 * an unreadable file means "no key", never an extension failure.
 */
export function readHubKeyFromDataDir(home?: string): string {
	const file = path.join(home ?? path.join(os.homedir(), '.free-model-hub'), 'hub', 'settings.json');
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { server?: { key?: string } };
		const key = parsed?.server?.key;
		return typeof key === 'string' ? key : '';
	} catch {
		return '';
	}
}
