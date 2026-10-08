// Build-time manifest of every docs page, served at /SHRINE/shrine-manifest.json.
// The install prompt (src/prompts/shrine-install.md) uses it to pin a commit and to
// diff pages by content hash on a re-run, and its refresh entry uses it to verify a newer
// prompt. Data only: no instructions belong here.
import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import prompt from '../prompts/shrine-install.md?raw';
import checker from '../tools/shrine-check.mjs?raw';

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
// raw.githubusercontent.com `source` an agent fetches. A missing file fails the build.
function fileSha(filePath: string | undefined, id: string): string {
	if (!filePath) throw new Error(`shrine-manifest: no filePath for ${id}`);
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

// The prompt's own version line, so a refresh can show the live version without parsing it.
// A prompt without one fails the build.
function promptVersion(text: string): number {
	const match = /^Prompt version: (\d+)$/m.exec(text);
	if (!match) throw new Error('shrine-manifest: no "Prompt version: <n>" line in the install prompt');
	return Number(match[1]);
}

export const GET: APIRoute = async () => {
	const commit = commitSha();
	const entries = await getCollection('docs');
	const pages = entries
		// The entry id is the stable sort key that makes the output byte-identical across
		// builds. The prompt does not read it, so it is dropped from the output.
		.slice()
		.sort((a: CollectionEntry<'docs'>, b: CollectionEntry<'docs'>) => a.id.localeCompare(b.id))
		.map((entry: CollectionEntry<'docs'>) => ({
			title: entry.data.title,
			description: entry.data.description ?? null,
			// Top-level docs folder ("principles", "patterns", ...) and ratification status, so
			// the prompt can list the North Star and every ratified principle from this file.
			section: entry.id.includes('/') ? entry.id.split('/')[0] : null,
			status: entry.data.status ?? null,
			// The page's site link, so the checker renders report links instead of the agent typing them.
			url: `${SITE}${entry.id === 'index' ? '' : `${entry.id}/`}`,
			source:
				commit === 'unknown'
					? null
					: `https://raw.githubusercontent.com/${REPO}/${commit}/docs/${entry.filePath}`,
			sha256: fileSha(entry.filePath, entry.id),
		}));

	const body = {
		commit,
		prompt: { version: promptVersion(prompt), sha256: createHash('sha256').update(prompt).digest('hex') },
		// The checker the prompt runs to render gates and check the record; the agent verifies this hash before running it.
		checker: {
			url: `${SITE}shrine-check.mjs`,
			source:
				commit === 'unknown'
					? null
					: `https://raw.githubusercontent.com/${REPO}/${commit}/docs/src/tools/shrine-check.mjs`,
			sha256: createHash('sha256').update(checker).digest('hex'),
		},
		pages,
	};
	return new Response(JSON.stringify(body, null, 2), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
};
