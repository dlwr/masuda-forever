import { describe, expect, it } from 'vitest';
import { encodeCandidates, pickCandidatePath, removeCandidate } from './candidates.js';

const URLS = [
	'https://anond.hatelabo.jp/20121013072616',
	'https://anond.hatelabo.jp/20121013080000',
	'https://anond.hatelabo.jp/20241013221242',
];

describe('encodeCandidates', () => {
	it('年ごとに時分秒を連結する', () => {
		expect(encodeCandidates(URLS)).toEqual({ '2012': '072616080000', '2024': '221242' });
	});

	it('記事URLでないものは無視する', () => {
		expect(encodeCandidates(['https://anond.hatelabo.jp/20121013'])).toEqual({});
	});
});

describe('pickCandidatePath', () => {
	const candidates = encodeCandidates(URLS);

	it('候補がなければ undefined', () => {
		expect(pickCandidatePath({}, '1013')).toBeUndefined();
	});

	it('年を一様に選んでから記事を選ぶ', () => {
		expect(pickCandidatePath(candidates, '1013', () => 0.99)).toBe('/20241013221242');
	});

	it('年の中の記事を乱数で選ぶ', () => {
		const random = [0, 0.6];
		expect(pickCandidatePath(candidates, '1013', () => random.shift()!)).toBe('/20121013080000');
	});
});

describe('removeCandidate', () => {
	it('指定した記事を候補から外す', () => {
		expect(removeCandidate(encodeCandidates(URLS), '/20121013072616')).toEqual({
			'2012': '080000',
			'2024': '221242',
		});
	});

	it('年の候補が空になったら年ごと外す', () => {
		expect(removeCandidate(encodeCandidates(URLS), '/20241013221242')).toEqual({ '2012': '072616080000' });
	});
});
