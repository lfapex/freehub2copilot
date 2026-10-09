/**
 * Picker grouping aligned with dsh-our-free-model: one Copilot vendor per
 * platform (OpenCode / Kilo / ZCode / TRAE / …). Copilot Chat groups
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
	{ vendor: 'freehub-free', displayName: 'OpenCode' },
	{ vendor: 'freehub-region', displayName: 'OpenCode · region-limited' },
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

	// Lanes are decided by the hub's own tags alone — never by id shape.
	// `owned_by` is stamped `kilo` on every Kilo row however its id is spelled
	// (`kilo-auto/free`, `openrouter/free`, `org/model:free`), so an id
	// heuristic buys nothing and only misfires: `:free` is Kilo's marker but
	// not Kilo-exclusive (Cline's free tier serves `:free` and `cline-free/`
	// ids), and `openrouter/` is a real upstream namespace, not a Kilo one.
	// Keep in step with `platformOf` in freehub2dsh.
	if (channel === 'kilo' || owned === 'kilo') {
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
		return { key: 'region', vendor: 'freehub-region', label: 'OpenCode · region-limited', order: 20 };
	}
	return { key: 'free', vendor: 'freehub-free', label: 'OpenCode', order: 10 };
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
 * Bare ids that name a *tier*, not a model — `kilo-auto/free` and
 * `openrouter/free` are two different free-pool routers whose identity lives
 * entirely in the `org/` half. Dropping the prefix would render both as a bare
 * `free` and leave two identical rows in the picker.
 */
const TIER_ONLY_BARE_IDS = new Set(['free']);

/**
 * Picker name: the model id exactly as upstream spells it — case, dots,
 * hyphens and any `-free`/`:free` suffix included, without the `org/`
 * routing prefix (the vendor heading already names the platform).
 * Hub-provided names are ignored: they are derived from the id, and any
 * rewrite (titleCase, slug prettifying) mangles version dots like `2.6`
 * and breaks the copy-paste round trip.
 *
 * The prefix is kept only where dropping it would lose the model itself —
 * `kilo-auto/free` and `openrouter/free` become `kilo-auto free` /
 * `openrouter free`. Every other id keeps the short bare name; spelling out
 * the vendor on all of them (`nvidia/nemotron-3.5-lightning:free`) only adds
 * length the heading already implies.
 */
export function displayNameOf(model: HubModel): string {
	const bare = bareId(model.id);
	const org = idHead(model.id);
	if (org !== '' && TIER_ONLY_BARE_IDS.has(bare.toLowerCase())) return `${org} ${bare}`;
	return bare;
}

export function sortByPlatform(models: HubModel[]): HubModel[] {
	const tagged = models.map(model => ({ model, platform: platformOf(model), name: displayNameOf(model) }));
	tagged.sort((a, b) => {
		if (a.platform.order !== b.platform.order) return a.platform.order - b.platform.order;
		if (a.platform.label !== b.platform.label) return a.platform.label.localeCompare(b.platform.label, 'zh-CN');
		return a.name.localeCompare(b.name, 'zh-CN');
	});
	return tagged.map(({ model }) => model);
}

function idHead(id: string): string {
	const slash = id.indexOf('/');
	return slash > 0 ? id.slice(0, slash) : '';
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
