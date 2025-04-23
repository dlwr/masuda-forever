import * as cheerio from 'cheerio';

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

export interface Database {
	prepare(query: string): Promise<{
		bind(...parameters: unknown[]): Promise<void>;
		get<T>(): Promise<T | null | undefined>;
		run(): Promise<{ changes?: number; lastID?: number }>;
		finalize(): Promise<void>;
	}>;
	close(): Promise<void>;
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
export async function scrapeAnondUrls(database: Database, maxPages?: number): Promise<ScrapeResult> {
	const startUrl = 'https://anond.hatelabo.jp/';
	logProgress('スクレイピング開始', { startUrl, maxPages });
	return await scrapeAnondUrlsRecursive(database, startUrl, maxPages);
}

/**
 * 特定日付のanond.hatelabo.jp/YYYYMMDD からURLをスクレイピングする
 */
export async function scrapeHistoricalAnondUrls(database: Database, date: string): Promise<HistoricalScrapeResult> {
	const startUrl = `https://anond.hatelabo.jp/${date}`;
	logProgress('履歴スクレイピング開始', { startUrl, date });
	const baseResult = await scrapeAnondUrlsRecursive(database, startUrl);
	return {
		...baseResult,
		date,
	};
}

/**
 * 月日の範囲に対する複数年スクレイピング
 */
export async function scrapeAnondUrlsDateRange(database: Database, startDate: string, endDate: string): Promise<ScrapeResult> {
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
						const result = await scrapeHistoricalAnondUrls(database, dateString);
						_totalNewUrls += result.newUrls.length;
						console.log(`Completed scraping for ${dateString}: ${result.newUrls.length} new URLs.`);
					} catch (error: unknown) {
						const reason = error instanceof Error ? error.message : String(error);
						// dateResult.failedYears[yearString] = reason;
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
				// response.failedDates[monthDay] = errorMessage;
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
async function scrapeAnondUrlsRecursive(database: Database, pageUrl: string, maxPages?: number): Promise<ScrapeResult> {
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

			let pageExistingUrls = 0;
			let pageNewUrls = 0;

			for (const article of pageArticles) {
				try {
					const selectStmt = await database.prepare('SELECT url FROM article_urls WHERE url = ?');
					await selectStmt.bind(article.url);
					const existingUrl = await selectStmt.get<{ url: string }>();
					await selectStmt.finalize();

					if (existingUrl) {
						pageExistingUrls++;
					} else {
						const insertStmt = await database.prepare('INSERT INTO article_urls (url, title) VALUES (?, ?)');
						await insertStmt.bind(article.url, article.title);
						await insertStmt.run();
						await insertStmt.finalize();

						result.newUrls.push(article);
						pageNewUrls++;
					}
				} catch (error) {
					logProgress('DB保存エラー', {
						error: error instanceof Error ? error.message : 'Unknown error',
						url: article.url,
					});
				}
			}

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
