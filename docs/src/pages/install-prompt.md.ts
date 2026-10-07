// Serves the install prompt as raw text at /SHRINE/install-prompt.md.
// Single source: src/prompts/shrine-install.md (also rendered on guide/install).
import type { APIRoute } from 'astro';
import prompt from '../prompts/shrine-install.md?raw';

export const GET: APIRoute = () =>
	new Response(prompt, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
