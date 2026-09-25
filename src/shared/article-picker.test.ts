import { describe, expect, it, vi } from 'vitest';
import { checkArticleStatus, pickLiveArticleUrl, pickUrlFromRandomYear } from './article-picker.js';

function statusFetcher(status: number) {
	return vi.fn(async () => new Response('', { status }));
}

describe('checkArticleStatus', () => {
	it('404 なら deleted', async () => {
		expect(await checkArticleStatus('https://anond.hatelabo.jp/20250711001127', statusFetcher(404))).toBe('deleted');
	});

	it('200 なら alive', async () => {
		expect(await checkArticleStatus('https://anond.hatelabo.jp/20250711001127', statusFetcher(200))).toBe('alive');
	});

	it('5xx なら unknown', async () => {
		expect(await checkArticleStatus('https://anond.hatelabo.jp/20250711001127', statusFetcher(503))).toBe('unknown');
	});

	it('fetch が失敗したら unknown', async () => {
		const failing = vi.fn(async () => {
			throw new Error('timeout');
		});
		expect(await checkArticleStatus('https://anond.hatelabo.jp/20250711001127', failing)).toBe('unknown');
	});
});

describe('pickLiveArticleUrl', () => {
	it('候補がなければ undefined を返す', async () => {
		const url = await pickLiveArticleUrl({
			// eslint-disable-next-line unicorn/no-useless-undefined
			pickRandomUrl: async () => undefined,
			checkStatus: async () => 'alive',
			markDeleted: async () => {},
		});
		expect(url).toBeUndefined();
	});

	it('生きている記事ならそのURLを返す', async () => {
		const url = await pickLiveArticleUrl({
			pickRandomUrl: async () => 'a',
			checkStatus: async () => 'alive',
			markDeleted: async () => {},
		});
		expect(url).toBe('a');
	});

	it('状態が分からない記事でもそのURLを返す', async () => {
		const url = await pickLiveArticleUrl({
			pickRandomUrl: async () => 'a',
			checkStatus: async () => 'unknown',
			markDeleted: async () => {},
		});
		expect(url).toBe('a');
	});

	it('削除済みの記事は印を付ける', async () => {
		const markDeleted = vi.fn(async () => {});
		await pickLiveArticleUrl({
			pickRandomUrl: vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b'),
			checkStatus: async (url) => (url === 'a' ? 'deleted' : 'alive'),
			markDeleted,
		});
		expect(markDeleted).toHaveBeenCalledWith('a');
	});

	it('削除済みの記事を引いたら選び直す', async () => {
		const url = await pickLiveArticleUrl({
			pickRandomUrl: vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b'),
			checkStatus: async (url) => (url === 'a' ? 'deleted' : 'alive'),
			markDeleted: async () => {},
		});
		expect(url).toBe('b');
	});

	it('3回続けて削除済みなら undefined を返す', async () => {
		const pickRandomUrl = vi.fn(async () => 'a');
		const url = await pickLiveArticleUrl({
			pickRandomUrl,
			checkStatus: async () => 'deleted',
			markDeleted: async () => {},
		});
		expect(url).toBeUndefined();
	});

	it('3回を超えて選び直さない', async () => {
		const pickRandomUrl = vi.fn(async () => 'a');
		await pickLiveArticleUrl({
			pickRandomUrl,
			checkStatus: async () => 'deleted',
			markDeleted: async () => {},
		});
		expect(pickRandomUrl).toHaveBeenCalledTimes(3);
	});
});

describe('pickUrlFromRandomYear', () => {
	it('記事のある年からURLを返す', async () => {
		const url = await pickUrlFromRandomYear(['2008', '2009', '2010'], async (year) =>
			year === '2008' ? 'https://anond.hatelabo.jp/20080229000000' : undefined,
		);
		expect(url).toBe('https://anond.hatelabo.jp/20080229000000');
	});

	it('どの年にも記事がなければ undefined を返す', async () => {
		const url = await pickUrlFromRandomYear(['2009', '2010'], async () => {});
		expect(url).toBeUndefined();
	});

	it('全ての年を1回ずつ探す', async () => {
		const findUrlInYear = vi.fn<(year: string) => Promise<void>>(async () => {});
		await pickUrlFromRandomYear(['2009', '2010', '2011'], findUrlInYear);
		expect(findUrlInYear.mock.calls.map(([year]) => year).sort()).toEqual(['2009', '2010', '2011']);
	});

	it('記事が見つかったらそれ以上探さない', async () => {
		const findUrlInYear = vi.fn(async () => 'https://anond.hatelabo.jp/20100925000000');
		await pickUrlFromRandomYear(['2009', '2010', '2011'], findUrlInYear);
		expect(findUrlInYear).toHaveBeenCalledTimes(1);
	});
});
