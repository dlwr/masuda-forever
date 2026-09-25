import { describe, expect, it } from 'vitest';
import { extractArticlesWithRegex, extractUrlDate } from './scraper.js';

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

function section(h3Inner: string): string {
	return `<div class="section">\n  <h3>\n    ${h3Inner}\n  </h3>\n</div>`;
}

const permalink = '<a href="/20260925164751"><span class="sanchor" data-no-highlight>■</span></a>';

describe('extractArticlesWithRegex', () => {
	it('パーマリンクから記事URLを取り出す', () => {
		expect(extractArticlesWithRegex(section(`${permalink}最近の変化`))[0].url).toBe('https://anond.hatelabo.jp/20260925164751');
	});

	it('キーワードリンクを含むタイトルをテキストとして取り出す', () => {
		const html = section(`${permalink}<a href="/keyword/%E6%9C%80%E8%BF%91" class="keyword">最近</a>の変化`);
		expect(extractArticlesWithRegex(html)[0].title).toBe('最近の変化');
	});

	it('タイトルのHTMLエンティティをデコードする', () => {
		expect(extractArticlesWithRegex(section(`${permalink}&#34;感動&#34; &amp; &lt;涙&gt;`))[0].title).toBe('"感動" & <涙>');
	});

	it('言及先エントリを開くボタンの文言はタイトルに含めない', () => {
		const html = section(
			`${permalink}<a href="/20260925164851">anond:20260925164851</a><button type="button" class="quote-expand-button">言及先エントリを開く</button>`,
		);
		expect(extractArticlesWithRegex(html)[0].title).toBe('anond:20260925164851');
	});

	it('タイトルがなければ ■ にする', () => {
		expect(extractArticlesWithRegex(section(permalink))[0].title).toBe('■');
	});

	it('ページ内の全記事を取り出す', () => {
		const html = section(permalink) + section('<a href="/20260925164329"><span class="sanchor">■</span></a>');
		expect(extractArticlesWithRegex(html)).toHaveLength(2);
	});
});
