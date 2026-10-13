import { describe, expect, it, vi } from 'vitest';
import { candidateDay, loadCandidates } from './candidate-store.js';

function fakeKv(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		store,
		kv: {
			get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : undefined)),
			put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
		} as unknown as KVNamespace,
	};
}

describe('candidateDay', () => {
	it('月日を MMDD にする', () => {
		expect(candidateDay(new Date('2026-01-05T00:00:00Z')).monthDay).toBe('0105');
	});

	it('9/24 以降は 2006 年から昨年まで', () => {
		expect(candidateDay(new Date('2026-10-13T00:00:00Z')).years).toEqual(Array.from({ length: 20 }, (_, index) => String(2006 + index)));
	});

	it('9/24 より前は 2007 年から', () => {
		expect(candidateDay(new Date('2026-09-23T00:00:00Z')).years[0]).toBe('2007');
	});

	it('KV のキーに年と月日を含める', () => {
		expect(candidateDay(new Date('2026-10-13T00:00:00Z')).key).toBe('candidates:v1:20261013');
	});
});

describe('loadCandidates', () => {
	it('KV になければ DB から作って KV に保存する', async () => {
		const day = candidateDay(new Date('2031-01-01T00:00:00Z'));
		const { kv, store } = fakeKv();
		const queryUrls = vi.fn(async () => ['https://anond.hatelabo.jp/20120101072616']);

		await loadCandidates(kv, day, queryUrls);

		expect(JSON.parse(store.get(day.key)!)).toEqual({ '2012': '072616' });
	});

	it('KV にあれば DB を引かない', async () => {
		const day = candidateDay(new Date('2031-01-02T00:00:00Z'));
		const { kv } = fakeKv({ [day.key]: JSON.stringify({ '2012': '072616' }) });
		const queryUrls = vi.fn(async () => []);

		await loadCandidates(kv, day, queryUrls);

		expect(queryUrls).not.toHaveBeenCalled();
	});

	it('2回目はメモリから返して KV を引かない', async () => {
		const day = candidateDay(new Date('2031-01-03T00:00:00Z'));
		const { kv } = fakeKv({ [day.key]: JSON.stringify({ '2012': '072616' }) });

		await loadCandidates(kv, day, async () => []);
		await loadCandidates(kv, day, async () => []);

		expect(kv.get).toHaveBeenCalledTimes(1);
	});
});
