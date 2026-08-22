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
          label: 'Principles',
          collapsed: false,
          items: [
            { label: 'TTV: Tokens to Value', slug: 'principles/ttv' },
            { label: 'Staying Current', slug: 'principles/staying-current' },
            { label: 'When to Re-evaluate', slug: 'principles/re-evaluate' },
          ],
        },
        {
          label: 'Patterns',
          collapsed: false,
          items: [
            { label: 'Overview', slug: 'patterns/overview' },
            { label: 'Adversarial Review', slug: 'patterns/adversarial-review' },
            { label: 'Multi-Model Consensus', slug: 'patterns/multi-model-consensus' },
            { label: 'Subagent Fanout', slug: 'patterns/subagent-fanout' },
            { label: 'Pipeline Orchestration', slug: 'patterns/pipeline-orchestration' },
            { label: 'Iterative Refinement', slug: 'patterns/iterative-refinement' },
            { label: 'Seed Planting', slug: 'patterns/seed-planting' },
          ],
        },
        {
          label: 'Stack',
          collapsed: true,
          items: [
            { label: 'Harness Selection', slug: 'stack/harness' },
            { label: 'Model Selection', slug: 'stack/models' },
            { label: 'Skills & Prompts', slug: 'stack/skills' },
            { label: 'Memory & Context', slug: 'stack/memory' },
            { label: 'Agent Architecture', slug: 'stack/agent-architecture' },
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
