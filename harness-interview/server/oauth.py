"""Google OAuth flow with @stablekernel.com domain restriction."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
ALLOWED_DOMAIN = "stablekernel.com"


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """Validated user identity (email stripped for pseudonymity)."""

    domain: str
    email_hash: str  # SHA256 of email, not the email itself


class AuthError(Exception):
    """Authentication failed."""


async def validate_google_token(access_token: str) -> AuthenticatedUser:
    """
    Validate Google OAuth access token and enforce domain restriction.

    Returns AuthenticatedUser with pseudonymous identity (hashed email).
    Raises AuthError if validation fails or domain is not allowed.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if resp.status_code != 200:
            logger.warning("Google userinfo request failed: %s", resp.status_code)
            raise AuthError("Invalid or expired access token")

        userinfo = resp.json()

    email = userinfo.get("email")
    email_verified = userinfo.get("email_verified", False)

    if not email or not email_verified:
        raise AuthError("Email not verified")

    domain = email.split("@")[-1].lower()
    if domain != ALLOWED_DOMAIN:
        logger.warning("Domain rejection: %s", domain)
        raise AuthError(f"Domain {domain} not allowed. Required: {ALLOWED_DOMAIN}")

    # Hash email for pseudonymity
    import hashlib

    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()

    return AuthenticatedUser(domain=domain, email_hash=email_hash)


def require_auth(
    handler: Callable[..., Awaitable],
) -> Callable[..., Awaitable]:
    """
    Decorator that validates OAuth token from MCP request context.

    The MCP SDK passes auth context; this extracts and validates it.
    """

    async def wrapper(*args, **kwargs):
        # MCP native OAuth passes token in request context
        # The exact mechanism depends on MCP SDK version
        ctx = kwargs.get("ctx") or (args[0] if args else None)

        if not ctx or not hasattr(ctx, "auth_token"):
            raise AuthError("No authentication context")

        user = await validate_google_token(ctx.auth_token)
        kwargs["authenticated_user"] = user

        return await handler(*args, **kwargs)

    return wrapper
