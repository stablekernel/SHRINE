// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://stablekernel.github.io',
  base: '/the-shrine/',
  integrations: [
    starlight({
      title: 'The Shrine',
      tagline: 'Stable-Kernel Hosted Reasoning & Inference Network Environment',
      description: 'LLM governance and tooling strategy for the org.',
      logo: {
        src: './src/assets/shrine-hero.png',
        alt: 'The Shrine',
        replacesTitle: true,
      },
      customCss: ['./src/styles/shrine.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/stablekernel/the-shrine' },
      ],
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Strategy',
          collapsed: false,
          items: [
            { label: 'TTV: Tokens to Value', slug: 'strategy/ttv' },
            { label: 'Staying Current', slug: 'strategy/staying-current' },
            { label: 'When to Re-evaluate', slug: 'strategy/re-evaluate' },
          ],
        },
        {
          label: 'Tooling',
          collapsed: true,
          items: [
            { label: 'Model Selection', slug: 'tooling/models' },
            { label: 'Skills & Prompts', slug: 'tooling/skills' },
            { label: 'Memory & Context', slug: 'tooling/memory' },
            { label: 'Agent Architecture', slug: 'tooling/agent-architecture' },
          ],
        },
        {
          label: 'Reference',
          collapsed: true,
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],
});
