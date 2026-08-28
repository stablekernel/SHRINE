"""Lambda entry point for harness-interview MCP server."""

from __future__ import annotations

import json
import logging
from typing import Any

from mangum import Mangum

from mcp_server import server

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def create_asgi_app():
    """
    Create ASGI application wrapping the MCP server.

    The MCP server handles the protocol; this wraps it for Lambda.
    """
    from mcp.server.sse import SseServerTransport

    transport = SseServerTransport("/mcp")

    async def app(scope, receive, send):
        """ASGI application."""
        if scope["type"] == "http":
            path = scope["path"]

            if path == "/mcp" or path.startswith("/mcp/"):
                # Handle MCP SSE transport
                await transport.handle_request(scope, receive, send, server)
            elif path == "/health":
                # Health check endpoint
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [[b"content-type", b"application/json"]],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": json.dumps({"status": "healthy"}).encode(),
                    }
                )
            else:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 404,
                        "headers": [[b"content-type", b"application/json"]],
                    }
                )
                await send(
                    {
                        "type": "http.response.body",
                        "body": json.dumps({"error": "Not found"}).encode(),
                    }
                )
        elif scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return

    return app


# Create the ASGI app
asgi_app = create_asgi_app()

# Wrap with Mangum for Lambda
handler = Mangum(asgi_app, lifespan="off")


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AWS Lambda entry point.

    Mangum handles the translation between Lambda events and ASGI.
    """
    return handler(event, context)
