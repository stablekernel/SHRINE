/**
 * Lambda entry point for harness-interview MCP server.
 *
 * Handles HTTP requests via Lambda Function URL, routing to the MCP server
 * for /mcp endpoints and providing a health check at /health.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  SUPPORTED_VERSIONS,
  InterviewSubmissionSchema,
  INTERVIEW_SUBMISSION_JSON_SCHEMA,
  type InterviewSubmission,
} from './schema.js';
import { validateGoogleToken, AuthError } from './oauth.js';
import { redactIfSecretsDetected } from './trufflehog.js';

// In Lambda, prompts are bundled alongside the handler via commandHooks
// When bundled, they're at ./prompts relative to the handler
const PROMPTS_DIR = join(__dirname, 'prompts');
const S3_BUCKET = process.env['INTERVIEW_BUCKET'] ?? 'shrine-harness-interviews';

const s3Client = new S3Client({});

/**
 * Load interview prompt for a given version.
 */
function loadPrompt(version: string): string {
  const promptFile = join(PROMPTS_DIR, `${version}.md`);
  if (!existsSync(promptFile)) {
    throw new Error(`No prompt found for version ${version}`);
  }
  return readFileSync(promptFile, 'utf-8');
}

/**
 * Sanitize submission data.
 */
function sanitizeSubmission(data: Record<string, unknown>): Record<string, unknown> {
  const selfAssessment = (data['self_assessment'] as Record<string, unknown>) ?? {};

  for (const field of ['biggest_friction', 'wish_list'] as const) {
    let text = (selfAssessment[field] as string) ?? '';
    if (text) {
      if (text.length > 500) {
        text = text.slice(0, 500);
      }
      selfAssessment[field] = redactIfSecretsDetected(text);
    }
  }

  delete data['email'];
  delete data['user_id'];
  delete data['name'];

  return data;
}

/**
 * Write validated submission to S3.
 */
async function writeToS3(submission: InterviewSubmission): Promise<string> {
  const timestamp = new Date(submission.timestamp);
  const dateStr = timestamp.toISOString().split('T')[0];
  const submissionId = randomUUID();
  const s3Key = `version=${submission.interview_version}/date=${dateStr}/${submissionId}.json`;

  const body = JSON.stringify(submission, null, 2);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: 'application/json',
    })
  );

  console.log(`Wrote submission to s3://${S3_BUCKET}/${s3Key}`);
  return s3Key;
}

interface McpRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Handle MCP JSON-RPC requests directly (simpler than SSE for Lambda).
 */
async function handleMcpRequest(request: McpRequest, authToken?: string): Promise<McpResponse> {
  const { method, params, id } = request;

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              resources: { subscribe: false, listChanged: false },
              tools: { listChanged: false },
            },
            serverInfo: { name: 'harness-interview', version: '1.0.0' },
          },
        };
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: SUPPORTED_VERSIONS.map((version) => ({
              uri: `interview://prompt/${version}`,
              name: `Interview Prompt ${version}`,
              description: `Harness interview prompt version ${version}`,
              mimeType: 'text/markdown',
            })),
          },
        };
      }

      case 'resources/read': {
        const uri = (params as { uri?: string })?.uri ?? '';
        if (!uri.startsWith('interview://prompt/')) {
          throw new Error(`Unknown resource URI: ${uri}`);
        }

        const version = uri.split('/').pop();
        if (!version || !SUPPORTED_VERSIONS.includes(version as (typeof SUPPORTED_VERSIONS)[number])) {
          throw new Error(`Unsupported version: ${version}`);
        }

        const content = loadPrompt(version);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [{ uri, mimeType: 'text/markdown', text: content }],
          },
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'submit_interview',
                description: 'Submit completed harness interview data',
                inputSchema: INTERVIEW_SUBMISSION_JSON_SCHEMA,
              },
            ],
          },
        };
      }

      case 'tools/call': {
        const toolParams = params as { name?: string; arguments?: Record<string, unknown> };
        if (toolParams?.name !== 'submit_interview') {
          throw new Error(`Unknown tool: ${toolParams?.name}`);
        }

        if (!authToken) {
          throw new AuthError('Authentication required');
        }

        const user = await validateGoogleToken(authToken);
        console.log(`Authenticated user from domain: ${user.domain}`);

        const sanitized = sanitizeSubmission(toolParams.arguments ?? {});
        const parseResult = InterviewSubmissionSchema.safeParse(sanitized);

        if (!parseResult.success) {
          console.warn('Validation failed:', parseResult.error.message);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Validation error: submission data is invalid or incomplete' }],
            },
          };
        }

        try {
          const s3Key = await writeToS3(parseResult.data);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Interview submitted successfully. Reference: ${s3Key}` }],
            },
          };
        } catch (error) {
          console.error('S3 write failed:', error);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Storage error: unable to save submission, please try again' }],
            },
          };
        }
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    };
  }
}

/**
 * Lambda handler for Function URL requests.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
  };

  // Health check endpoint
  if (path === '/health' && method === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ status: 'healthy' }),
    };
  }

  // MCP endpoint
  if (path === '/mcp' || path.startsWith('/mcp/')) {
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' },
      };
    }

    // POST requests contain MCP JSON-RPC messages
    if (method === 'POST') {
      const body = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
        : event.body;

      if (!body) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ error: 'Empty request body' }),
        };
      }

      // Extract auth token from Authorization header
      const authHeader = event.headers['authorization'] ?? event.headers['Authorization'];
      const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

      try {
        const request = JSON.parse(body) as McpRequest;
        const response = await handleMcpRequest(request, authToken);

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          body: JSON.stringify(response),
        };
      } catch (error) {
        console.error('Request parsing error:', error);
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          body: JSON.stringify({ error: 'Invalid JSON-RPC request' }),
        };
      }
    }
  }

  // 404 for unknown paths
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify({ error: 'Not found' }),
  };
}
