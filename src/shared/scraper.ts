import * as cheerio from 'cheerio';
import type { Client } from '@libsql/client';

export interface ArticleURL {
	url: string;
	title: string;
}

export interface ScrapeResult {
	newUrls: ArticleURL[];
	existingUrlsCount: number;
	pagesScraped: number;
}

export interface HistoricalScrapeResult extends ScrapeResult {
	date: string;
}

/**
 * 軽量スクレイピング結果（1ページ分）
 */
export interface LightScrapeResult {
	articles: ArticleURL[];
	nextPageUrl: string | undefined;
	insertedCount: number;
}

/**
 * 進捗ログを出力する
 */
function logProgress(message: string, data?: Record<string, unknown>) {
	const timestamp = new Date().toISOString();
	const logMessage = `[${timestamp}] ${message}`;
	if (data) {
		console.log(logMessage, data);
	} else {
		console.log(logMessage);
	}
}

/**
 * anond.hatelabo.jpからURLをスクレイピングする
 */
export async function scrapeAnondUrls(client: Client, maxPages?: number): Promise<ScrapeResult> {
	const startUrl = 'https://anond.hatelabo.jp/';
	logProgress('スクレイピング開始', { startUrl, maxPages });
	return await scrapeAnondUrlsRecursive(client, startUrl, maxPages);
}

/**
 * 特定日付のanond.hatelabo.jp/YYYYMMDD からURLをスクレイピングする
 */
export async function scrapeHistoricalAnondUrls(client: Client, date: string): Promise<HistoricalScrapeResult> {
	const startUrl = `https://anond.hatelabo.jp/${date}`;
	logProgress('履歴スクレイピング開始', { startUrl, date });
	const baseResult = await scrapeAnondUrlsRecursive(client, startUrl);
	return {
		...baseResult,
		date,
	};
}

/**
 * 月日の範囲に対する複数年スクレイピング
 */
export async function scrapeAnondUrlsDateRange(client: Client, startDate: string, endDate: string): Promise<ScrapeResult> {
	const startMonth = Number.parseInt(startDate.slice(0, 2), 10);
	const startDay = Number.parseInt(startDate.slice(2, 4), 10);
	const endMonth = Number.parseInt(endDate.slice(0, 2), 10);
	const endDay = Number.parseInt(endDate.slice(2, 4), 10);

	const monthDayRegex = /^\d{4}$/;
	if (!monthDayRegex.test(startDate) || !monthDayRegex.test(endDate)) {
		throw new Error('日付はMMDD形式で指定してください (例: 0101)。');
	}

	if (startMonth < 1 || startMonth > 12 || startDay < 1 || startDay > 31 || endMonth < 1 || endMonth > 12 || endDay < 1 || endDay > 31) {
		throw new Error('無効な月日形式です。MMDD形式で指定してください (例: 0101)。');
	}

	try {
		// 日付の配列を作成
		const dates: string[] = generateMonthDaysBetween(startDate, endDate);
		console.log(`処理する日付範囲: ${dates.join(', ')} (${dates.length}日間)`);

		let totalNewUrls = 0;
		// 各日付に対して順次処理
		for (const monthDay of dates) {
			console.log(`日付 ${monthDay} の処理を開始`);
			try {
				// 個別の月日に対するスクレイピングロジックを再利用
				const startYear = 2006;
				const endYear = 2025;
				let _totalNewUrls = 0;

				// 各年を順番に処理
				for (let year = startYear; year <= endYear; year++) {
					const yearString = String(year);
					const dateString = `${yearString}${monthDay}`; // YYYYMMDD
					console.log(`Scraping for date: ${dateString}`);
					try {
						const result = await scrapeHistoricalAnondUrls(client, dateString);
						_totalNewUrls += result.newUrls.length;
						console.log(`Completed scraping for ${dateString}: ${result.newUrls.length} new URLs.`);
					} catch (error: unknown) {
						const reason = error instanceof Error ? error.message : String(error);
						console.error(`Failed scraping for ${dateString}: ${reason}`);
					}

					// 各年の処理間に待機時間を追加（例: 500ミリ秒）
					await new Promise((resolve) => setTimeout(resolve, 500));
				}

				// 日付の結果を全体結果に追加
				totalNewUrls += _totalNewUrls;
				console.log(`日付 ${monthDay} の処理完了: ${totalNewUrls}件の新規URL追加`);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`日付 ${monthDay} の処理エラー: ${errorMessage}`);
			}

			// 各日付の処理間に待機時間を追加（例: 1000ミリ秒）
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		return {
			newUrls: [],
			existingUrlsCount: 0,
			pagesScraped: 0,
		};
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(errorMessage);
	}
}

/**
 * 開始月日から終了月日までの月日の配列を生成する
 * 例: 0101から0105までなら ['0101', '0102', '0103', '0104', '0105']
 */
function generateMonthDaysBetween(startMonthDay: string, endMonthDay: string): string[] {
	// 基準年を設定（うるう年を考慮して2024年を使用）
	const baseYear = 2024;
	const startMonth = Number.parseInt(startMonthDay.slice(0, 2), 10);
	const startDay = Number.parseInt(startMonthDay.slice(2, 4), 10);
	const endMonth = Number.parseInt(endMonthDay.slice(0, 2), 10);
	const endDay = Number.parseInt(endMonthDay.slice(2, 4), 10);

	const startDate = new Date(baseYear, startMonth - 1, startDay);
	const endDate = new Date(baseYear, endMonth - 1, endDay);

	// 開始日が終了日より後の場合は、年を跨ぐものとして扱う
	if (startDate > endDate) {
		endDate.setFullYear(baseYear + 1);
	}

	const dates: string[] = [];
	const currentDate = new Date(startDate);

	while (currentDate <= endDate) {
		const month = String(currentDate.getMonth() + 1).padStart(2, '0');
		const day = String(currentDate.getDate()).padStart(2, '0');
		dates.push(`${month}${day}`);

		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dates;
}

/**
 * 再帰的にページをスクレイピングする
 */
async function scrapeAnondUrlsRecursive(client: Client, pageUrl: string, maxPages?: number): Promise<ScrapeResult> {
	const result: ScrapeResult = {
		newUrls: [],
		existingUrlsCount: 0,
		pagesScraped: 0,
	};

	let currentUrl = pageUrl;
	let pagesProcessed = 0;
	const startTime = Date.now();
	const TIMEOUT_MS = 300_000; // 5分のタイムアウト設定

	while (currentUrl && (!maxPages || pagesProcessed < maxPages)) {
		if (Date.now() - startTime > TIMEOUT_MS) {
			logProgress('タイムアウトによりスクレイピングを中断');
			break;
		}

		try {
			logProgress('ページを取得中', { currentUrl, pagesProcessed });
			const response = await fetch(currentUrl);
			if (!response.ok) {
				throw new Error(`スクレイピング失敗: ${response.status} ${response.statusText}`);
			}

			const html = await response.text();
			const $ = cheerio.load(html);

			const pageArticles: ArticleURL[] = [];
			$('div.section').each((_, element) => {
				const linkElement = $(element).find('h3 a');
				const url = linkElement.attr('href');
				const title = linkElement.text().trim() || '■';

				if (url) {
					const fullUrl = url.startsWith('http') ? url : `https://anond.hatelabo.jp${url}`;
					pageArticles.push({ url: fullUrl, title });
				}
			});

			logProgress('記事を処理中', {
				pageUrl: currentUrl,
				foundArticles: pageArticles.length,
			});

			// N+1パターン解消: INSERT OR IGNORE で一括挿入
			// 重複はDBレベルで無視される
			const insertedCount = await batchInsertUrls(client, pageArticles);
			const pageNewUrls = insertedCount;
			const pageExistingUrls = pageArticles.length - insertedCount;

			// 新規挿入された記事を結果に追加（正確なカウントのみ）
			result.newUrls.push(...pageArticles.slice(0, insertedCount));

			result.existingUrlsCount += pageExistingUrls;
			result.pagesScraped++;
			pagesProcessed++;

			logProgress('ページ処理完了', {
				pageUrl: currentUrl,
				newUrls: pageNewUrls,
				existingUrls: pageExistingUrls,
				totalPagesProcessed: pagesProcessed,
				elapsedTime: `${((Date.now() - startTime) / 1000).toFixed(1)}秒`,
			});

			const nextPageLink = $('.pager-l a')
				.filter((_, element) => $(element).text().includes('次'))
				.attr('href');

			if (nextPageLink) {
				currentUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://anond.hatelabo.jp${nextPageLink}`;
			} else {
				currentUrl = '';
			}

			await new Promise((resolve) => setTimeout(resolve, 500));
		} catch (error) {
			logProgress('ページスクレイピングエラー', {
				error: error instanceof Error ? error.message : 'Unknown error',
				pageUrl: currentUrl,
			});
			break;
		}
	}

	logProgress('スクレイピング完了', {
		totalPages: result.pagesScraped,
		totalNewUrls: result.newUrls.length,
		totalExistingUrls: result.existingUrlsCount,
		elapsedTime: `${((Date.now() - startTime) / 1000).toFixed(1)}秒`,
	});

	return result;
}

/**
 * 正規表現ベースの軽量HTMLパーサー（CPU使用量削減版）
 * cheerioの代わりに使用してCPU時間を節約
 */
export function extractArticlesWithRegex(html: string): ArticleURL[] {
	const articles: ArticleURL[] = [];
	// <div class="section">...<h3><a href="/YYYYMMDDHHMMSS">... のパターンをマッチ
	// 最初のリンクがパーマリンク（/YYYYMMDDHHMMSS形式）
	const regex = /<div class="section"[^>]*>[\s\S]*?<h3>\s*<a href="(\/\d{14})"/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(html)) !== null) {
		const url = `https://anond.hatelabo.jp${match[1]}`;
		articles.push({ url, title: '■' });
	}
	return articles;
}

/**
 * 次のページURLを正規表現で抽出
 */
export function extractNextPageUrl(html: string): string | undefined {
	// "次の25件>" または "次の25件&gt;" のパターンをマッチ
	const match = html.match(/<a href="([^"]+)"[^>]*>次の\d+件[>&]/);
	if (!match) return undefined;
	// HTMLエンティティをデコード
	const url = match[1].replaceAll('&amp;', '&');
	return url.startsWith('http') ? url : `https://anond.hatelabo.jp${url}`;
}

/**
 * バッチ挿入（複数URLを1回のSQLで挿入、CPU時間とDB往復を削減）
 */
export async function batchInsertUrls(client: Client, articles: ArticleURL[]): Promise<number> {
	if (articles.length === 0) return 0;

	// INSERT OR IGNORE で重複を無視
	// url_year, url_monthday を同時に挿入（URLから抽出）
	const placeholders = articles.map(() => '(?, ?, ?, ?)').join(', ');
	const sqlArguments = articles.flatMap((a) => {
		// URL形式: https://anond.hatelabo.jp/YYYYMMDDHHMMSS
		// 位置27から4文字が年（YYYY）、位置31から4文字が月日（MMDD）
		const urlYear = a.url.length >= 31 ? a.url.slice(27, 31) : '';
		const urlMonthDay = a.url.length >= 35 ? a.url.slice(31, 35) : '';
		return [a.url, a.title, urlYear, urlMonthDay];
	});

	const result = await client.execute({
		sql: `INSERT OR IGNORE INTO article_urls (url, title, url_year, url_monthday) VALUES ${placeholders}`,
		args: sqlArguments,
	});

	return result.rowsAffected;
}

/**
 * 軽量スクレイピング: 1ページだけ処理（Cloudflare Workers無料プラン向け）
 * - 正規表現パーサー使用
 * - バッチ挿入使用
 * - ページネーション情報を返却
 */
export async function scrapeSinglePageLight(client: Client, pageUrl: string): Promise<LightScrapeResult> {
	logProgress('軽量スクレイピング開始', { pageUrl });

	const response = await fetch(pageUrl);
	if (!response.ok) {
		throw new Error(`スクレイピング失敗: ${response.status} ${response.statusText}`);
	}

	const html = await response.text();

	// 正規表現でパース（CPU軽量）
	const articles = extractArticlesWithRegex(html);
	const nextPageUrl = extractNextPageUrl(html);

	// バッチ挿入
	const insertedCount = await batchInsertUrls(client, articles);

	logProgress('軽量スクレイピング完了', {
		pageUrl,
		foundArticles: articles.length,
		insertedCount,
		hasNextPage: nextPageUrl !== undefined,
	});

	return {
		articles,
		nextPageUrl,
		insertedCount,
	};
}
