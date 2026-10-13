import { describe, expect, it, vi } from 'vitest';
import { checkArticleStatus, pickLiveArticleUrl } from './article-picker.js';

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
