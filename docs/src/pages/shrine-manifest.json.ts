// Build-time manifest of every docs page, served at /SHRINE/shrine-manifest.json.
// It pins the docs commit and lists each page's source link and hash, so a reader can
// verify a page it fetched. Data only: no instructions belong here.
import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'stablekernel/SHRINE';
const SITE = 'https://stablekernel.github.io/SHRINE/';

function commitSha(): string {
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return 'unknown';
	}
}

// Hash the raw file bytes, frontmatter included, so the value matches the pinned
// raw.githubusercontent.com `source` a reader fetches. A missing file fails the build.
function fileSha(filePath: string | undefined, id: string): string {
	if (!filePath) throw new Error(`shrine-manifest: no filePath for ${id}`);
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export const GET: APIRoute = async () => {
	const commit = commitSha();
	const entries = await getCollection('docs');
	const pages = entries
		// The entry id is the stable sort key that makes the output byte-identical across
		// builds. It is dropped from the output.
		.slice()
		.sort((a: CollectionEntry<'docs'>, b: CollectionEntry<'docs'>) => a.id.localeCompare(b.id))
		.map((entry: CollectionEntry<'docs'>) => ({
			title: entry.data.title,
			description: entry.data.description ?? null,
			// Top-level docs folder ("principles", "patterns", ...) and ratification status, so
			// a reader can list the North Star and every ratified principle from this file.
			section: entry.id.includes('/') ? entry.id.split('/')[0] : null,
			status: entry.data.status ?? null,
			url: `${SITE}${entry.id === 'index' ? '' : `${entry.id}/`}`,
			source:
				commit === 'unknown'
					? null
					: `https://raw.githubusercontent.com/${REPO}/${commit}/docs/${entry.filePath}`,
			sha256: fileSha(entry.filePath, entry.id),
		}));

	const body = { commit, pages };
	return new Response(JSON.stringify(body, null, 2), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
};
