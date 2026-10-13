import { describe, expect, it } from 'vitest';
import { isMirroredPath, rewriteHref, rewriteStaticAssetUrl } from './mirror.js';

describe('isMirroredPath', () => {
	it('記事パスは中継する', () => {
		expect(isMirroredPath('/20261013175208')).toBe(true);
	});

	it('assets は中継する', () => {
		expect(isMirroredPath('/assets/main-CK4FQbav.js')).toBe(true);
	});

	it('日付ページは中継しない', () => {
		expect(isMirroredPath('/20261013')).toBe(false);
	});

	it('検索は中継しない', () => {
		expect(isMirroredPath('/search')).toBe(false);
	});
});

describe('rewriteHref', () => {
	it('本家の記事URLはミラー内のパスにする', () => {
		expect(rewriteHref('https://anond.hatelabo.jp/20261013174631')).toBe('/20261013174631');
	});

	it('本家の記事URLのフラグメントを残す', () => {
		expect(rewriteHref('https://anond.hatelabo.jp/20261013174631#tb')).toBe('/20261013174631#tb');
	});

	it('ルート相対の記事パスはそのまま', () => {
		expect(rewriteHref('/20261013175208#tb')).toBe('/20261013175208#tb');
	});

	it('記事以外のルート相対パスは本家に向ける', () => {
		expect(rewriteHref('/keyword/%E3%83%95')).toBe('https://anond.hatelabo.jp/keyword/%E3%83%95');
	});

	it('トップは本家に向ける', () => {
		expect(rewriteHref('/')).toBe('https://anond.hatelabo.jp/');
	});

	it('外部URLはそのまま', () => {
		expect(rewriteHref('https://b.hatena.ne.jp/entry/s/anond.hatelabo.jp/20261013175208')).toBe(
			'https://b.hatena.ne.jp/entry/s/anond.hatelabo.jp/20261013175208',
		);
	});

	it('ページ内リンクはそのまま', () => {
		expect(rewriteHref('#')).toBe('#');
	});

	it('プロトコル相対URLはそのまま', () => {
		expect(rewriteHref('//www.googletagmanager.com/ns.html')).toBe('//www.googletagmanager.com/ns.html');
	});
});

describe('rewriteStaticAssetUrl', () => {
	it('assets は本家から直接読ませる', () => {
		expect(rewriteStaticAssetUrl('/assets/main-CW36ffMW.css')).toBe('https://anond.hatelabo.jp/assets/main-CW36ffMW.css');
	});

	it('assets 以外はそのまま', () => {
		expect(rewriteStaticAssetUrl('https://b.st-hatena.com/images/entry-button/button-only@2x.png')).toBe(
			'https://b.st-hatena.com/images/entry-button/button-only@2x.png',
		);
	});
});
