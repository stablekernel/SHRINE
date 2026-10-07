// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://stablekernel.github.io',
  base: '/SHRINE/',
  integrations: [
    starlight({
      title: 'SHRINE',
      favicon: '/favicon.png',
      tagline: 'Stable-Kernel Hosted Reasoning & Inference Network Environment',
      description: 'LLM governance and tooling strategy for the org.',
      logo: {
        src: './src/assets/shrine-hero.png',
        alt: 'SHRINE',
        replacesTitle: true,
      },
      customCss: ['./src/styles/shrine.css'],
      components: {
        PageTitle: './src/components/PageTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/stablekernel/SHRINE' },
      ],
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Principles',
          collapsed: false,
          // MAINTAINER: Order is deliberate, not alphabetical (Overview, North Star, then who decides,
          // where humans judge, how we engage, how we shape code, how systems fail, how we trust output, how we evolve)
          items: [
            { label: 'Overview', slug: 'principles' },
            { label: 'North Star: TTV', slug: 'principles/tokens-to-value' },
            { label: 'Authority Cascade', slug: 'principles/authority-cascade' },
            { label: 'Human in the Loop', slug: 'principles/human-in-the-loop' },
            { label: 'Problem Before Prescription', slug: 'principles/problem-before-prescription' },
            { label: 'Consistency as Leverage', slug: 'principles/consistency-as-leverage' },
            { label: 'Fail Fast, Recover Smart', slug: 'principles/fail-fast-recover-smart' },
            { label: 'Reproducibility', slug: 'principles/reproducibility' },
            { label: 'Deliberate Currency', slug: 'principles/deliberate-currency' },
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
            { label: 'Checkpoint Gates', slug: 'patterns/checkpoint-gates' },
            { label: 'Context Handoff', slug: 'patterns/context-handoff' },
            { label: 'Correction Diagnosis', slug: 'patterns/correction-diagnosis' },
            { label: 'Delegation Fit', slug: 'patterns/delegation-fit' },
            { label: 'Discovery Propagation', slug: 'patterns/discovery-propagation' },
            { label: 'Dogfooding', slug: 'patterns/dogfooding' },
            { label: 'Few-Shot Examples', slug: 'patterns/few-shot-examples' },
            { label: 'Iterative Refinement', slug: 'patterns/iterative-refinement' },
            { label: 'Mechanical Scaffolding', slug: 'patterns/mechanical-scaffolding' },
            { label: 'Multi-Model Consensus', slug: 'patterns/multi-model-consensus' },
            { label: 'Pipeline Orchestration', slug: 'patterns/pipeline-orchestration' },
            { label: 'Progress Breadcrumbs', slug: 'patterns/progress-breadcrumbs' },
            { label: 'Prompt Regression Testing', slug: 'patterns/prompt-regression' },
            { label: 'RAG', slug: 'patterns/rag' },
            { label: 'Reviewable Output', slug: 'patterns/reviewable-output' },
            { label: 'Self-Critique', slug: 'patterns/self-critique' },
            { label: 'Spec, Then Build', slug: 'patterns/spec-then-build' },
            { label: 'Step-Level Routing', slug: 'patterns/step-level-routing' },
            { label: 'Structured Output', slug: 'patterns/structured-output' },
            { label: 'Subagent Fanout', slug: 'patterns/subagent-fanout' },
            { label: 'Task Routing', slug: 'patterns/task-routing' },
            { label: 'Unattended Runs', slug: 'patterns/unattended-runs' },
            { label: 'Verification Loops', slug: 'patterns/verification-loops' },
          ],
        },
        {
          label: 'Stack',
          collapsed: true,
          // MAINTAINER: Keep entries in alphabetical order (Overview first, then A-Z)
          items: [
            { label: 'Overview', slug: 'stack/overview' },
            { label: 'Agent Architecture', slug: 'stack/agent-architecture' },
            { label: 'Cost Management', slug: 'stack/cost-management' },
            { label: 'Evaluation & Benchmarking', slug: 'stack/evaluation' },
            { label: 'Harness Selection', slug: 'stack/harness' },
            { label: 'Memory & Context', slug: 'stack/memory' },
            { label: 'Model Selection', slug: 'stack/models' },
            { label: 'Observability & Logging', slug: 'stack/observability' },
            { label: 'Repository Context', slug: 'stack/repository-context' },
            { label: 'Skills & Prompts', slug: 'stack/skills' },
            { label: 'Tool Integration', slug: 'stack/tool-integration' },
          ],
        },
        { label: 'FAQ', link: '/faq/' },
        {
          label: 'Reference',
          collapsed: true,
          items: [{ autogenerate: { directory: 'reference' } }],
        },
      ],
    }),
  ],
});
