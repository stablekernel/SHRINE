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
            { label: 'Authority Cascade', slug: 'principles/authority-cascade' },
            { label: 'Consistency as Leverage', slug: 'principles/consistency-as-leverage' },
            { label: 'Fail Fast, Recover Smart', slug: 'principles/fail-fast' },
            { label: 'Human in the Loop', slug: 'principles/human-in-the-loop' },
            { label: 'Reproducibility', slug: 'principles/reproducibility' },
          ],
        },
        {
          label: 'Patterns',
          collapsed: false,
          // MAINTAINER: Keep entries in alphabetical order (Overview first, then A-Z)
          items: [
            { label: 'Overview', slug: 'patterns/overview' },
            { label: 'Adversarial Review', slug: 'patterns/adversarial-review' },
            { label: 'Chain of Thought', slug: 'patterns/chain-of-thought' },
            { label: 'Discovery Propagation', slug: 'patterns/discovery-propagation' },
            { label: 'Dogfooding', slug: 'patterns/dogfooding' },
            { label: 'Few-Shot Examples', slug: 'patterns/few-shot-examples' },
            { label: 'Iterative Refinement', slug: 'patterns/iterative-refinement' },
            { label: 'Multi-Model Consensus', slug: 'patterns/multi-model-consensus' },
            { label: 'Pipeline Orchestration', slug: 'patterns/pipeline-orchestration' },
            { label: 'RAG', slug: 'patterns/rag' },
            { label: 'Self-Critique', slug: 'patterns/self-critique' },
            { label: 'Structured Output', slug: 'patterns/structured-output' },
            { label: 'Subagent Fanout', slug: 'patterns/subagent-fanout' },
            { label: 'Verification Loops', slug: 'patterns/verification-loops' },
          ],
        },
        {
          label: 'Stack',
          collapsed: true,
          // MAINTAINER: Keep entries in alphabetical order (A-Z)
          items: [
            { label: 'Agent Architecture', slug: 'stack/agent-architecture' },
            { label: 'Cost Management', slug: 'stack/cost-management' },
            { label: 'Evaluation & Benchmarking', slug: 'stack/evaluation' },
            { label: 'Harness Selection', slug: 'stack/harness' },
            { label: 'Memory & Context', slug: 'stack/memory' },
            { label: 'Model Selection', slug: 'stack/models' },
            { label: 'Observability & Logging', slug: 'stack/observability' },
            { label: 'Skills & Prompts', slug: 'stack/skills' },
            { label: 'Tool Integration', slug: 'stack/tool-integration' },
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
