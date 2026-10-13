import { type Candidates, encodeCandidates, removeCandidate } from './candidates.js';

const MEMORY_TTL_MS = 10 * 60 * 1000;
const KV_EDGE_TTL = 3600;
const KV_EXPIRATION = 3 * 24 * 3600;

export type CandidateDay = { monthDay: string; years: string[]; key: string };

type QueryUrls = (years: string[], monthDay: string) => Promise<string[]>;

const memory = new Map<string, { candidates: Candidates; expiresAt: number }>();

export function candidateDay(jstDate: Date): CandidateDay {
	const month = jstDate.getUTCMonth() + 1;
	const day = jstDate.getUTCDate();
	const currentYear = jstDate.getUTCFullYear();
	const monthDay = `${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
	// anond の最初の記事は 2006-09-24
	const startYear = month > 9 || (month === 9 && day >= 24) ? 2006 : 2007;
	const years = Array.from({ length: Math.max(0, currentYear - startYear) }, (_, index) => String(startYear + index));
	return { monthDay, years, key: `candidates:v1:${currentYear}${monthDay}` };
}

export async function buildCandidates(kv: KVNamespace, day: CandidateDay, queryUrls: QueryUrls): Promise<Candidates> {
	const candidates = encodeCandidates(await queryUrls(day.years, day.monthDay));
	await kv.put(day.key, JSON.stringify(candidates), { expirationTtl: KV_EXPIRATION });
	memory.set(day.key, { candidates, expiresAt: Date.now() + MEMORY_TTL_MS });
	return candidates;
}

export async function loadCandidates(kv: KVNamespace, day: CandidateDay, queryUrls: QueryUrls): Promise<Candidates> {
	const cached = memory.get(day.key);
	if (cached && cached.expiresAt > Date.now()) return cached.candidates;

	const stored = await kv.get<Candidates>(day.key, { type: 'json', cacheTtl: KV_EDGE_TTL });
	if (stored) {
		memory.set(day.key, { candidates: stored, expiresAt: Date.now() + MEMORY_TTL_MS });
		return stored;
	}

	return buildCandidates(kv, day, queryUrls);
}

export function forgetCandidate(day: CandidateDay, path: string): void {
	const cached = memory.get(day.key);
	if (cached) memory.set(day.key, { ...cached, candidates: removeCandidate(cached.candidates, path) });
}
