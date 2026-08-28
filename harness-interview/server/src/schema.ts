/**
 * Zod schemas for harness-interview MCP server.
 * Ports the Pydantic models from the Python implementation.
 */

import { z } from 'zod';

export const SUPPORTED_VERSIONS = ['v1'] as const;
export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

export const EstimationMethodSchema = z.enum(['measured', 'estimated', 'guessed']);
export type EstimationMethod = z.infer<typeof EstimationMethodSchema>;

export const SessionFrequencySchema = z.enum(['1-5', '5-20', '20+']);
export type SessionFrequency = z.infer<typeof SessionFrequencySchema>;

export const SubagentUsageSchema = z.enum(['never', 'sometimes', 'frequently']);
export type SubagentUsage = z.infer<typeof SubagentUsageSchema>;

export const ContextBudgetSchema = z.object({
  total_tokens: z.number().int().nonnegative(),
  estimated_frontmatter_tokens: z.number().int().nonnegative(),
  frontmatter_ratio: z.number().min(0).max(1),
  method: EstimationMethodSchema,
});
export type ContextBudget = z.infer<typeof ContextBudgetSchema>;

export const ToolsLandscapeSchema = z.object({
  total_count: z.number().int().nonnegative(),
  builtin_count: z.number().int().nonnegative(),
  mcp_provided_count: z.number().int().nonnegative(),
  deferred_count: z.number().int().nonnegative(),
  categories: z.record(z.string(), z.number().int()),
  method: EstimationMethodSchema,
});
export type ToolsLandscape = z.infer<typeof ToolsLandscapeSchema>;

export const McpServersSchema = z.object({
  count: z.number().int().nonnegative(),
  types: z.array(z.string()),
  tool_counts_per_server: z.array(z.number().int()),
});
export type McpServers = z.infer<typeof McpServersSchema>;

export const SkillsSchema = z.object({
  count: z.number().int().nonnegative(),
  plugin_provided: z.number().int().nonnegative(),
  user_authored: z.number().int().nonnegative(),
});
export type Skills = z.infer<typeof SkillsSchema>;

export const PromptsSchema = z.object({
  system_prompt_tokens: z.number().int().nonnegative(),
  claude_md_tokens: z.number().int().nonnegative(),
  rules_file_count: z.number().int().nonnegative(),
});
export type Prompts = z.infer<typeof PromptsSchema>;

export const UsagePatternsSchema = z.object({
  estimated_sessions_per_week: SessionFrequencySchema,
  primary_task_types: z.array(z.string()),
  subagent_usage: SubagentUsageSchema,
});
export type UsagePatterns = z.infer<typeof UsagePatternsSchema>;

export const SelfAssessmentSchema = z.object({
  throughput: z.number().int().min(1).max(5),
  efficiency: z.number().int().min(1).max(5),
  skill_level: z.number().int().min(1).max(5),
  biggest_friction: z.string().max(500).default(''),
  wish_list: z.string().max(500).default(''),
});
export type SelfAssessment = z.infer<typeof SelfAssessmentSchema>;

export const HarnessSchema = z.object({
  type: z.string(),
  version: z.string(),
});
export type Harness = z.infer<typeof HarnessSchema>;

export const InterviewSubmissionSchema = z.object({
  interview_version: z.enum(SUPPORTED_VERSIONS),
  timestamp: z.string().datetime(),
  harness: HarnessSchema,
  context_budget: ContextBudgetSchema,
  tools_landscape: ToolsLandscapeSchema,
  mcp_servers: McpServersSchema,
  skills: SkillsSchema,
  prompts: PromptsSchema,
  usage_patterns: UsagePatternsSchema,
  self_assessment: SelfAssessmentSchema,
  os: z.string(),
  hooks_count: z.number().int().nonnegative(),
  permission_mode: z.string(),
  memory_present: z.boolean(),
  session_complete: z.boolean(),
  partial_sections: z.array(z.string()).default([]),
});
export type InterviewSubmission = z.infer<typeof InterviewSubmissionSchema>;

/**
 * JSON Schema for MCP tool input validation.
 * Matches the Zod schema but in JSON Schema format for MCP.
 */
export const INTERVIEW_SUBMISSION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    interview_version: {
      type: 'string',
      enum: SUPPORTED_VERSIONS,
      description: 'Interview version identifier',
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'ISO8601 timestamp',
    },
    harness: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['type', 'version'],
    },
    context_budget: {
      type: 'object',
      properties: {
        total_tokens: { type: 'integer', minimum: 0 },
        estimated_frontmatter_tokens: { type: 'integer', minimum: 0 },
        frontmatter_ratio: { type: 'number', minimum: 0, maximum: 1 },
        method: { type: 'string', enum: ['measured', 'estimated', 'guessed'] },
      },
      required: ['total_tokens', 'estimated_frontmatter_tokens', 'frontmatter_ratio', 'method'],
    },
    tools_landscape: {
      type: 'object',
      properties: {
        total_count: { type: 'integer', minimum: 0 },
        builtin_count: { type: 'integer', minimum: 0 },
        mcp_provided_count: { type: 'integer', minimum: 0 },
        deferred_count: { type: 'integer', minimum: 0 },
        categories: { type: 'object' },
        method: { type: 'string', enum: ['measured', 'estimated', 'guessed'] },
      },
      required: ['total_count', 'builtin_count', 'mcp_provided_count', 'deferred_count', 'categories', 'method'],
    },
    mcp_servers: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 0 },
        types: { type: 'array', items: { type: 'string' } },
        tool_counts_per_server: { type: 'array', items: { type: 'integer' } },
      },
      required: ['count', 'types', 'tool_counts_per_server'],
    },
    skills: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 0 },
        plugin_provided: { type: 'integer', minimum: 0 },
        user_authored: { type: 'integer', minimum: 0 },
      },
      required: ['count', 'plugin_provided', 'user_authored'],
    },
    prompts: {
      type: 'object',
      properties: {
        system_prompt_tokens: { type: 'integer', minimum: 0 },
        claude_md_tokens: { type: 'integer', minimum: 0 },
        rules_file_count: { type: 'integer', minimum: 0 },
      },
      required: ['system_prompt_tokens', 'claude_md_tokens', 'rules_file_count'],
    },
    usage_patterns: {
      type: 'object',
      properties: {
        estimated_sessions_per_week: { type: 'string', enum: ['1-5', '5-20', '20+'] },
        primary_task_types: { type: 'array', items: { type: 'string' } },
        subagent_usage: { type: 'string', enum: ['never', 'sometimes', 'frequently'] },
      },
      required: ['estimated_sessions_per_week', 'primary_task_types', 'subagent_usage'],
    },
    self_assessment: {
      type: 'object',
      properties: {
        throughput: { type: 'integer', minimum: 1, maximum: 5 },
        efficiency: { type: 'integer', minimum: 1, maximum: 5 },
        skill_level: { type: 'integer', minimum: 1, maximum: 5 },
        biggest_friction: { type: 'string', maxLength: 500 },
        wish_list: { type: 'string', maxLength: 500 },
      },
      required: ['throughput', 'efficiency', 'skill_level', 'biggest_friction', 'wish_list'],
    },
    os: { type: 'string' },
    hooks_count: { type: 'integer', minimum: 0 },
    permission_mode: { type: 'string' },
    memory_present: { type: 'boolean' },
    session_complete: { type: 'boolean' },
    partial_sections: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'interview_version',
    'timestamp',
    'harness',
    'context_budget',
    'tools_landscape',
    'mcp_servers',
    'skills',
    'prompts',
    'usage_patterns',
    'self_assessment',
    'os',
    'hooks_count',
    'permission_mode',
    'memory_present',
    'session_complete',
  ],
} as const;
