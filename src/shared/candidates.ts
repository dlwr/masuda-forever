/** 年 → その年・同じ月日の記事の時分秒（6桁）を連結した文字列 */
export type Candidates = Record<string, string>;

const TIME_LENGTH = 6;
const ARTICLE_PATH = /^\/(\d{4})(\d{4})(\d{6})$/;

export function encodeCandidates(urls: string[]): Candidates {
	const candidates: Candidates = {};
	for (const url of urls) {
		const match = ARTICLE_PATH.exec(new URL(url).pathname);
		if (!match) continue;
		candidates[match[1]] = (candidates[match[1]] ?? '') + match[3];
	}

	return candidates;
}

export function pickCandidatePath(candidates: Candidates, monthDay: string, random: () => number = Math.random): string | undefined {
	const years = Object.keys(candidates).filter((year) => candidates[year].length > 0);
	if (years.length === 0) return undefined;

	const year = years[Math.floor(random() * years.length)];
	const times = candidates[year];
	const index = Math.floor(random() * (times.length / TIME_LENGTH)) * TIME_LENGTH;
	return `/${year}${monthDay}${times.slice(index, index + TIME_LENGTH)}`;
}

export function removeCandidate(candidates: Candidates, path: string): Candidates {
	const match = ARTICLE_PATH.exec(path);
	if (!match) return candidates;

	const [, year, , time] = match;
	const times = candidates[year] ?? '';
	const remaining = [];
	for (let index = 0; index < times.length; index += TIME_LENGTH) {
		const candidate = times.slice(index, index + TIME_LENGTH);
		if (candidate !== time) remaining.push(candidate);
	}

	const updated = { ...candidates };
	if (remaining.length > 0) updated[year] = remaining.join('');
	else delete updated[year];
	return updated;
}
