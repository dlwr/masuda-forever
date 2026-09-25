import { describe, expect, it } from 'vitest';
import { extractUrlDate } from './scraper.js';

describe('extractUrlDate', () => {
	it('記事URLから年を取り出す', () => {
		expect(extractUrlDate('https://anond.hatelabo.jp/20250619123456').year).toBe('2025');
	});

	it('記事URLから月日を取り出す', () => {
		expect(extractUrlDate('https://anond.hatelabo.jp/20250619123456').monthDay).toBe('0619');
	});

	it('日付部分が足りないURLでは空文字を返す', () => {
		expect(extractUrlDate('https://anond.hatelabo.jp/2025')).toEqual({ year: '2025', monthDay: '' });
	});
});
