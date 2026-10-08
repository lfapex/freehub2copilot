/**
 * Picker grouping aligned with dsh-our-free-model: one Copilot vendor per
 * platform (Our Free Model / Kilo / ZCode / TRAE / …). Copilot Chat groups
 * strictly by `languageModelChatProviders.vendor`, so a single "Free Model
 * Hub" vendor would dump the whole roster into one section.
 */

import type { HubModel } from './types';

export interface Platform {
	key: string;
	vendor: string;
	label: string;
	order: number;
}

export interface PickerVendor {
	vendor: string;
	displayName: string;
}

/** Must stay in sync with `contributes.languageModelChatProviders` in package.json. */
export const PICKER_VENDORS: readonly PickerVendor[] = [
	{ vendor: 'freehub-free', displayName: 'Our Free Model' },
	{ vendor: 'freehub-region', displayName: 'Our Free Model · region-limited' },
	{ vendor: 'freehub-kilo', displayName: 'Kilo' },
	{ vendor: 'freehub-atomcode', displayName: 'AtomCode' },
	{ vendor: 'freehub-codearts', displayName: 'CodeArts Agent' },
	{ vendor: 'freehub-buddy', displayName: 'CodeBuddy (腾讯)' },
	{ vendor: 'freehub-workbuddy', displayName: 'WorkBuddy (国际版)' },
	{ vendor: 'freehub-lobsterai', displayName: 'LobsterAI (有道)' },
	{ vendor: 'freehub-qoder', displayName: 'Qoder' },
	{ vendor: 'freehub-qodercn', displayName: 'Qoder (中国版)' },
	{ vendor: 'freehub-trae', displayName: 'TRAE (字节)' },
	{ vendor: 'freehub-cline', displayName: 'Cline' },
	{ vendor: 'freehub-loomy', displayName: 'Loomy (讯飞)' },
	{ vendor: 'freehub-raccoon', displayName: 'Raccoon (商汤)' },
	{ vendor: 'freehub-minimax', displayName: 'MiniMax Code' },
	{ vendor: 'freehub-zcode', displayName: 'ZCode (智谱)' },
	{ vendor: 'freehub-opencode', displayName: 'OpenCode' },
	{ vendor: 'freehub-gemini', displayName: 'Gemini Code Assist' },
	{ vendor: 'freehub-relay', displayName: 'Relay' },
	{ vendor: 'freehub-virtual', displayName: 'Virtual' },
	{ vendor: 'freehub', displayName: 'Free Model Hub' },
];

const CATCH_ALL_VENDOR = 'freehub';

/** Channel-pack provider ids → the same labels the dsh picker uses. */
const CHANNEL_LABELS: Record<string, { label: string; order: number; vendor: string }> = {
	codearts: { label: 'CodeArts Agent', order: 50, vendor: 'freehub-codearts' },
	buddy: { label: 'CodeBuddy (腾讯)', order: 51, vendor: 'freehub-buddy' },
	workbuddy: { label: 'WorkBuddy (国际版)', order: 52, vendor: 'freehub-workbuddy' },
	lobsterai: { label: 'LobsterAI (有道)', order: 53, vendor: 'freehub-lobsterai' },
	qoder: { label: 'Qoder', order: 54, vendor: 'freehub-qoder' },
	qodercn: { label: 'Qoder (中国版)', order: 55, vendor: 'freehub-qodercn' },
	trae: { label: 'TRAE (字节)', order: 56, vendor: 'freehub-trae' },
	cline: { label: 'Cline', order: 57, vendor: 'freehub-cline' },
	loomy: { label: 'Loomy (讯飞)', order: 58, vendor: 'freehub-loomy' },
	raccoon: { label: 'Raccoon (商汤)', order: 59, vendor: 'freehub-raccoon' },
	minimax: { label: 'MiniMax Code', order: 60, vendor: 'freehub-minimax' },
	zcode: { label: 'ZCode (智谱)', order: 61, vendor: 'freehub-zcode' },
	opencode: { label: 'OpenCode', order: 62, vendor: 'freehub-opencode' },
	gemini: { label: 'Gemini Code Assist', order: 63, vendor: 'freehub-gemini' },
};

const CHANNEL_IDS = new Set(Object.keys(CHANNEL_LABELS));

const VENDOR_PREFIXES = PICKER_VENDORS
	.map((row) => `${row.vendor}/`)
	.sort((a, b) => b.length - a.length);

export function platformOf(model: HubModel): Platform {
	const owned = (model.ownedBy ?? '').trim();
	const channel = (model.channel ?? '').trim();
	const provider = (model.provider ?? '').trim();
	const id = model.id;

	if (channel === 'kilo' || owned === 'kilo' || isKiloId(id)) {
		return { key: 'kilo', vendor: 'freehub-kilo', label: 'Kilo', order: 30 };
	}
	if (channel === 'atomcode' || owned === 'atomcode' || id.startsWith('atomcode/')) {
		return { key: 'atomcode', vendor: 'freehub-atomcode', label: 'AtomCode', order: 40 };
	}
	if (channel === 'virtual' || owned === 'virtual') {
		return { key: 'virtual', vendor: 'freehub-virtual', label: 'Virtual', order: 90 };
	}
	if (channel === 'relay' || owned.startsWith('relay:')) {
		const relayId = owned.startsWith('relay:') ? owned.slice(6) : (provider || 'relay');
		const label = relayId && relayId !== 'relay' ? `Relay · ${relayId}` : 'Relay';
		return { key: `relay:${relayId}`, vendor: 'freehub-relay', label, order: 80 };
	}

	const chanProvider = channel === 'chan' || owned.startsWith('chan:')
		? (provider || (owned.startsWith('chan:') ? owned.slice(5) : idHead(id)))
		: CHANNEL_IDS.has(idHead(id)) ? idHead(id) : '';
	if (chanProvider !== '') {
		const known = CHANNEL_LABELS[chanProvider];
		return {
			key: `chan:${chanProvider}`,
			vendor: known?.vendor ?? CATCH_ALL_VENDOR,
			label: known?.label ?? titleCase(chanProvider),
			order: known?.order ?? 70,
		};
	}

	if (model.state === 'region-blocked' || model.state === 'regionBlocked') {
		return { key: 'region', vendor: 'freehub-region', label: 'Our Free Model · region-limited', order: 20 };
	}
	return { key: 'free', vendor: 'freehub-free', label: 'Our Free Model', order: 10 };
}

const HIDDEN_STATES = new Set(['unavailable', 'region-blocked', 'regionblocked', '不可用']);

/** Copilot only advertises models this egress can actually call. */
export function isPickerVisible(model: HubModel): boolean {
	if (model.routable === false) return false;
	const state = (model.state ?? '').trim().toLowerCase();
	if (state !== '' && HIDDEN_STATES.has(state)) return false;
	return true;
}

export function canonicalAtomcodeId(id: string): string {
	return id.replace(/^atomcode\//i, '').replace(/^atomgit-/i, '').toLowerCase();
}

export function dedupeVisible(models: HubModel[]): HubModel[] {
	const seen = new Set<string>();
	const out: HubModel[] = [];
	for (const model of models) {
		if (!isPickerVisible(model)) continue;
		const platform = platformOf(model);
		const key = platform.vendor === 'freehub-atomcode'
			? `atom:${canonicalAtomcodeId(model.id)}`
			: `${platform.vendor}:${model.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(model);
	}
	return out;
}

export function modelsForVendor(models: HubModel[], vendor: string): HubModel[] {
	return models.filter((model) => platformOf(model).vendor === vendor);
}

/** Strip Copilot's `vendor/` prefix so the hub sees the catalog id. */
export function stripVendorPrefix(rawId: string): string {
	for (const prefix of VENDOR_PREFIXES) {
		if (rawId.startsWith(prefix)) return rawId.slice(prefix.length);
	}
	return rawId;
}

/**
 * Same picker names dsh-our-free-model uses:
 * free lane → pretty catalog names (never a raw slug);
 * Kilo → `Kilo …` with org prefix and `(free)` stripped;
 * account channels → the model's own name, without the `provider/` routing prefix
 * (the Copilot vendor heading already names the platform).
 */
export function displayNameOf(model: HubModel): string {
	const platform = platformOf(model);
	const given = typeof model.name === 'string' ? model.name.trim() : '';
	const id = model.id;

	if (platform.vendor === 'freehub-kilo') return kiloDisplayName(given, id);

	if (platform.vendor === 'freehub-free' || platform.vendor === 'freehub-region') {
		const known = FREE_DISPLAY_NAMES[id] ?? FREE_DISPLAY_NAMES[bareId(id)];
		if (known !== undefined) return known;
		if (isPrettyName(given, id)) return given;
		return titleCase(bareId(id).replace(/-free$/i, ''));
	}

	if (isPrettyName(given, id)) return given;
	return titleCase(bareId(id));
}

/** Human-facing names for the anonymous free lane, copied from dsh-our-free-model. */
const FREE_DISPLAY_NAMES: Record<string, string> = {
	'mimo-v2.6-flash-free': 'MiMo V2.6 Flash',
	'mimo-v2.5-free': 'MiMo V2.5',
	'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
	'muse-spark-1.2-contributor-free': 'Muse Spark 1.2',
	'nemotron-3-ultra-free': 'Nemotron 3 Ultra',
	'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning',
	'ling-3.0-flash-fin-free': 'Ling 3.0 Flash Fin',
	'space-bunny-free': 'Space Bunny',
	'union-alpha': 'Union Alpha',
	'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
	'jev-1.13-free': 'Jev 1.13',
};

function kiloDisplayName(given: string, id: string): string {
	const raw = given !== '' ? given : id;
	const stripped = raw
		.replace(/^Kilo\s+/i, '')
		.replace(/^[^:]{1,40}:\s+/, '')
		.replace(/\s*\(free\)\s*$/i, '')
		.trim();
	const pretty = isPrettyName(stripped, id) ? stripped : titleCase(bareId(id).replace(/:free$/i, ''));
	return `Kilo ${pretty}`;
}

/** True when `name` is already a picker label, not a routing id. */
function isPrettyName(name: string, id: string): boolean {
	if (name === '') return false;
	if (name === id) return false;
	if (name.includes('/')) return false;
	if (/^[a-z0-9]+(?:[-_.:][a-z0-9]+)+$/.test(name)) return false;
	return true;
}

export function sortByPlatform(models: HubModel[]): HubModel[] {
	return [...models].sort((a, b) => {
		const pa = platformOf(a);
		const pb = platformOf(b);
		if (pa.order !== pb.order) return pa.order - pb.order;
		if (pa.label !== pb.label) return pa.label.localeCompare(pb.label, 'zh-CN');
		return displayNameOf(a).localeCompare(displayNameOf(b), 'zh-CN');
	});
}

function idHead(id: string): string {
	const slash = id.indexOf('/');
	return slash > 0 ? id.slice(0, slash) : '';
}

function isKiloId(id: string): boolean {
	if (id.includes(':free') || id.startsWith('kilo-auto/') || id.startsWith('openrouter/')) return true;
	return false;
}

function bareId(id: string): string {
	const slash = id.lastIndexOf('/');
	return slash >= 0 ? id.slice(slash + 1) : id;
}

function titleCase(raw: string): string {
	return raw
		.replace(/[-_.:]+/g, ' ')
		.trim()
		.split(/\s+/)
		.map((word) => (/^\d/.test(word) || word.toUpperCase() === word ? word : word.charAt(0).toUpperCase() + word.slice(1)))
		.join(' ');
}
