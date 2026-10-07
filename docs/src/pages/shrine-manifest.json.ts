// Build-time manifest of every docs page, served at /SHRINE/shrine-manifest.json.
// The install prompt (src/prompts/shrine-install.md) uses it to pin a commit and to
// diff pages by content hash on a re-run. Data only: no instructions belong here.
import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import prompt from '../prompts/shrine-install.md?raw';

const REPO = 'stablekernel/SHRINE';

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

export const GET: APIRoute = async () => {
	const commit = commitSha();
	const entries = await getCollection('docs');
	const pages = entries
		.map((entry: CollectionEntry<'docs'>) => ({
			// Not read by the prompt; kept as the stable sort key that makes the output
			// byte-identical across builds.
			id: entry.id,
			title: entry.data.title,
			description: entry.data.description ?? null,
			source:
				commit === 'unknown'
					? null
					: `https://raw.githubusercontent.com/${REPO}/${commit}/docs/${entry.filePath}`,
			sha256: fileSha(entry.filePath, entry.id),
		}))
		.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));

	const body = {
		commit,
		prompt: { sha256: createHash('sha256').update(prompt).digest('hex') },
		pages,
	};
	return new Response(JSON.stringify(body, null, 2), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
};
