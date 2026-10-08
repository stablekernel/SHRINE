// Serves the inspect prompt as raw text at /SHRINE/inspect-prompt.md.
// Single source: src/prompts/shrine-inspect.md (also rendered on guide/inspect).
import type { APIRoute } from 'astro';
import prompt from '../prompts/shrine-inspect.md?raw';

export const GET: APIRoute = () =>
	new Response(prompt, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
