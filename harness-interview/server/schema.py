"""Pydantic models for harness-interview MCP server."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class EstimationMethod(str, Enum):
    """How a measurement was obtained."""

    MEASURED = "measured"
    ESTIMATED = "estimated"
    GUESSED = "guessed"


class SessionFrequency(str, Enum):
    """Estimated sessions per week."""

    LOW = "1-5"
    MEDIUM = "5-20"
    HIGH = "20+"


class SubagentUsage(str, Enum):
    """How often subagents are used."""

    NEVER = "never"
    SOMETIMES = "sometimes"
    FREQUENTLY = "frequently"


class ContextBudget(BaseModel):
    """Context window budget breakdown."""

    total_tokens: int = Field(ge=0)
    estimated_frontmatter_tokens: int = Field(ge=0)
    frontmatter_ratio: float = Field(ge=0.0, le=1.0)
    method: EstimationMethod


class ToolsLandscape(BaseModel):
    """Breakdown of available tools."""

    total_count: int = Field(ge=0)
    builtin_count: int = Field(ge=0)
    mcp_provided_count: int = Field(ge=0)
    deferred_count: int = Field(ge=0)
    categories: dict[str, int] = Field(default_factory=dict)
    method: EstimationMethod


class McpServers(BaseModel):
    """MCP server configuration summary."""

    count: int = Field(ge=0)
    types: list[str] = Field(default_factory=list)
    tool_counts_per_server: list[int] = Field(default_factory=list)


class Skills(BaseModel):
    """Skills inventory."""

    count: int = Field(ge=0)
    plugin_provided: int = Field(ge=0)
    user_authored: int = Field(ge=0)


class Prompts(BaseModel):
    """Prompt configuration summary."""

    system_prompt_tokens: int = Field(ge=0)
    claude_md_tokens: int = Field(ge=0)
    rules_file_count: int = Field(ge=0)


class UsagePatterns(BaseModel):
    """Self-reported usage patterns."""

    estimated_sessions_per_week: SessionFrequency
    primary_task_types: list[str] = Field(default_factory=list)
    subagent_usage: SubagentUsage


class SelfAssessment(BaseModel):
    """User self-assessment ratings."""

    throughput: int = Field(ge=1, le=5)
    efficiency: int = Field(ge=1, le=5)
    skill_level: int = Field(ge=1, le=5)
    biggest_friction: str = Field(max_length=500, default="")
    wish_list: str = Field(max_length=500, default="")

    @field_validator("biggest_friction", "wish_list", mode="before")
    @classmethod
    def truncate_text(cls, v: str) -> str:
        """Truncate free-text fields to 500 chars."""
        if isinstance(v, str) and len(v) > 500:
            return v[:500]
        return v


# Supported interview versions
SUPPORTED_VERSIONS = frozenset({"v1"})


class InterviewSubmission(BaseModel):
    """Complete interview submission payload."""

    interview_version: Literal["v1"] = Field(description="Interview version identifier")
    timestamp: datetime
    harness: dict[Literal["type", "version"], str]
    context_budget: ContextBudget
    tools_landscape: ToolsLandscape
    mcp_servers: McpServers
    skills: Skills
    prompts: Prompts
    usage_patterns: UsagePatterns
    self_assessment: SelfAssessment
    os: str
    hooks_count: int = Field(ge=0)
    permission_mode: str
    memory_present: bool
    session_complete: bool
    partial_sections: list[str] = Field(default_factory=list)

    @field_validator("interview_version", mode="before")
    @classmethod
    def validate_version(cls, v: str) -> str:
        """Reject unsupported interview versions."""
        if v not in SUPPORTED_VERSIONS:
            msg = f"Unsupported interview version: {v}. Supported: {SUPPORTED_VERSIONS}"
            raise ValueError(msg)
        return v
