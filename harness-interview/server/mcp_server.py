"""MCP server implementation for harness-interview."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import boto3
from mcp.server import Server
from mcp.server.models import InitializationOptions
from mcp.types import Resource, TextContent, Tool

from oauth import AuthError, validate_google_token
from schema import SUPPORTED_VERSIONS, InterviewSubmission

logger = logging.getLogger(__name__)

# Configuration
S3_BUCKET = os.environ.get("INTERVIEW_BUCKET", "shrine-harness-interviews")
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# Initialize MCP server
server = Server("harness-interview")


def _load_prompt(version: str) -> str:
    """Load interview prompt for a given version."""
    prompt_file = PROMPTS_DIR / f"{version}.md"
    if not prompt_file.exists():
        msg = f"No prompt found for version {version}"
        raise FileNotFoundError(msg)
    return prompt_file.read_text()


def _run_trufflehog(text: str) -> bool:
    """
    Scan text with TruffleHog for secrets.

    Returns True if clean, False if secrets detected.
    """
    if not text.strip():
        return True

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(text)
            temp_path = f.name

        result = subprocess.run(
            ["trufflehog", "filesystem", temp_path, "--json", "--no-update"],
            capture_output=True,
            text=True,
            timeout=30,
        )

        # TruffleHog outputs JSON lines for each finding
        findings = [line for line in result.stdout.strip().split("\n") if line]

        if findings:
            logger.warning("TruffleHog detected %d potential secrets", len(findings))
            return False

        return True

    except FileNotFoundError:
        logger.error("TruffleHog not installed, rejecting submission for safety")
        return False
    except subprocess.TimeoutExpired:
        logger.error("TruffleHog scan timed out, rejecting submission for safety")
        return False
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


def _sanitize_submission(data: dict[str, Any]) -> dict[str, Any]:
    """
    Strip identity and validate free-text fields.

    - Removes any email/identity fields that might leak through
    - Runs TruffleHog on free-text fields
    - Truncates free-text to 500 chars
    """
    # Ensure free-text fields are clean
    self_assessment = data.get("self_assessment", {})

    for field in ("biggest_friction", "wish_list"):
        text = self_assessment.get(field, "")
        if text:
            # Truncate
            if len(text) > 500:
                self_assessment[field] = text[:500]
            # Check for secrets
            if not _run_trufflehog(text):
                self_assessment[field] = "[REDACTED: potential secret detected]"

    # Remove any identity fields that shouldn't be there
    data.pop("email", None)
    data.pop("user_id", None)
    data.pop("name", None)

    return data


def _write_to_s3(submission: InterviewSubmission) -> str:
    """Write validated submission to S3."""
    s3 = boto3.client("s3")

    # Build S3 path: version={v}/date={YYYY-MM-DD}/{uuid}.json
    date_str = submission.timestamp.strftime("%Y-%m-%d")
    submission_id = str(uuid.uuid4())
    s3_key = f"version={submission.interview_version}/date={date_str}/{submission_id}.json"

    # Serialize
    body = submission.model_dump_json(indent=2)

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=body.encode("utf-8"),
        ContentType="application/json",
    )

    logger.info("Wrote submission to s3://%s/%s", S3_BUCKET, s3_key)
    return s3_key


# ============================================================================
# MCP Resources
# ============================================================================


@server.list_resources()
async def list_resources() -> list[Resource]:
    """List available interview prompt resources."""
    resources = []
    for version in SUPPORTED_VERSIONS:
        resources.append(
            Resource(
                uri=f"interview://prompt/{version}",
                name=f"Interview Prompt {version}",
                description=f"Harness interview prompt version {version}",
                mimeType="text/markdown",
            )
        )
    return resources


@server.read_resource()
async def read_resource(uri: str) -> str:
    """Read an interview prompt resource."""
    # Parse URI: interview://prompt/{version}
    if not uri.startswith("interview://prompt/"):
        msg = f"Unknown resource URI: {uri}"
        raise ValueError(msg)

    version = uri.split("/")[-1]
    if version not in SUPPORTED_VERSIONS:
        msg = f"Unsupported version: {version}. Supported: {SUPPORTED_VERSIONS}"
        raise ValueError(msg)

    return _load_prompt(version)


# ============================================================================
# MCP Tools
# ============================================================================


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="submit_interview",
            description="Submit completed harness interview data",
            inputSchema={
                "type": "object",
                "properties": {
                    "interview_version": {
                        "type": "string",
                        "enum": list(SUPPORTED_VERSIONS),
                        "description": "Interview version identifier",
                    },
                    "timestamp": {
                        "type": "string",
                        "format": "date-time",
                        "description": "ISO8601 timestamp",
                    },
                    "harness": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string"},
                            "version": {"type": "string"},
                        },
                        "required": ["type", "version"],
                    },
                    "context_budget": {
                        "type": "object",
                        "properties": {
                            "total_tokens": {"type": "integer", "minimum": 0},
                            "estimated_frontmatter_tokens": {
                                "type": "integer",
                                "minimum": 0,
                            },
                            "frontmatter_ratio": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                            },
                            "method": {
                                "type": "string",
                                "enum": ["measured", "estimated", "guessed"],
                            },
                        },
                        "required": [
                            "total_tokens",
                            "estimated_frontmatter_tokens",
                            "frontmatter_ratio",
                            "method",
                        ],
                    },
                    "tools_landscape": {
                        "type": "object",
                        "properties": {
                            "total_count": {"type": "integer", "minimum": 0},
                            "builtin_count": {"type": "integer", "minimum": 0},
                            "mcp_provided_count": {"type": "integer", "minimum": 0},
                            "deferred_count": {"type": "integer", "minimum": 0},
                            "categories": {"type": "object"},
                            "method": {
                                "type": "string",
                                "enum": ["measured", "estimated", "guessed"],
                            },
                        },
                        "required": [
                            "total_count",
                            "builtin_count",
                            "mcp_provided_count",
                            "deferred_count",
                            "categories",
                            "method",
                        ],
                    },
                    "mcp_servers": {
                        "type": "object",
                        "properties": {
                            "count": {"type": "integer", "minimum": 0},
                            "types": {"type": "array", "items": {"type": "string"}},
                            "tool_counts_per_server": {
                                "type": "array",
                                "items": {"type": "integer"},
                            },
                        },
                        "required": ["count", "types", "tool_counts_per_server"],
                    },
                    "skills": {
                        "type": "object",
                        "properties": {
                            "count": {"type": "integer", "minimum": 0},
                            "plugin_provided": {"type": "integer", "minimum": 0},
                            "user_authored": {"type": "integer", "minimum": 0},
                        },
                        "required": ["count", "plugin_provided", "user_authored"],
                    },
                    "prompts": {
                        "type": "object",
                        "properties": {
                            "system_prompt_tokens": {"type": "integer", "minimum": 0},
                            "claude_md_tokens": {"type": "integer", "minimum": 0},
                            "rules_file_count": {"type": "integer", "minimum": 0},
                        },
                        "required": [
                            "system_prompt_tokens",
                            "claude_md_tokens",
                            "rules_file_count",
                        ],
                    },
                    "usage_patterns": {
                        "type": "object",
                        "properties": {
                            "estimated_sessions_per_week": {
                                "type": "string",
                                "enum": ["1-5", "5-20", "20+"],
                            },
                            "primary_task_types": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "subagent_usage": {
                                "type": "string",
                                "enum": ["never", "sometimes", "frequently"],
                            },
                        },
                        "required": [
                            "estimated_sessions_per_week",
                            "primary_task_types",
                            "subagent_usage",
                        ],
                    },
                    "self_assessment": {
                        "type": "object",
                        "properties": {
                            "throughput": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 5,
                            },
                            "efficiency": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 5,
                            },
                            "skill_level": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 5,
                            },
                            "biggest_friction": {"type": "string", "maxLength": 500},
                            "wish_list": {"type": "string", "maxLength": 500},
                        },
                        "required": [
                            "throughput",
                            "efficiency",
                            "skill_level",
                            "biggest_friction",
                            "wish_list",
                        ],
                    },
                    "os": {"type": "string"},
                    "hooks_count": {"type": "integer", "minimum": 0},
                    "permission_mode": {"type": "string"},
                    "memory_present": {"type": "boolean"},
                    "session_complete": {"type": "boolean"},
                    "partial_sections": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "interview_version",
                    "timestamp",
                    "harness",
                    "context_budget",
                    "tools_landscape",
                    "mcp_servers",
                    "skills",
                    "prompts",
                    "usage_patterns",
                    "self_assessment",
                    "os",
                    "hooks_count",
                    "permission_mode",
                    "memory_present",
                    "session_complete",
                ],
            },
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle tool calls."""
    if name != "submit_interview":
        msg = f"Unknown tool: {name}"
        raise ValueError(msg)

    # Get auth context from MCP request
    # Note: MCP native OAuth will pass this through the server context
    auth_token = server.request_context.get("auth_token") if hasattr(server, "request_context") else None

    if not auth_token:
        raise AuthError("Authentication required")

    # Validate token and domain
    user = await validate_google_token(auth_token)
    logger.info("Authenticated user from domain: %s", user.domain)

    # Sanitize submission (strip identity, check for secrets)
    sanitized = _sanitize_submission(arguments)

    # Validate against schema
    try:
        submission = InterviewSubmission(**sanitized)
    except Exception as e:
        logger.warning("Validation failed: %s", e)
        return [TextContent(type="text", text="Validation error: submission data is invalid or incomplete")]

    # Write to S3
    try:
        s3_key = _write_to_s3(submission)
    except Exception as e:
        logger.exception("S3 write failed")
        return [TextContent(type="text", text="Storage error: unable to save submission, please try again")]

    return [
        TextContent(
            type="text",
            text=f"Interview submitted successfully. Reference: {s3_key}",
        )
    ]


# ============================================================================
# Server entrypoint (for direct execution)
# ============================================================================


async def main():
    """Run the MCP server."""
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="harness-interview",
                server_version="1.0.0",
            ),
        )


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
