// Serves the read-only SHRINE checker as raw text at /SHRINE/shrine-check.mjs.
// Single source: src/tools/shrine-check.mjs; its sha256 is in shrine-manifest.json.
import type { APIRoute } from 'astro';
import checker from '../tools/shrine-check.mjs?raw';

export const GET: APIRoute = () =>
	new Response(checker, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
