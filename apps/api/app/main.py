"""
ChessRabbit API.

A ChessBase-style chess database and analysis platform.
Configured UCI engines run on the machine hosting the application.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.breaker import snapshot_all
from app.core.config import settings
from app.core.db import engine
from app.core.http_cache import cached_json, etag_response
from app.core.redis_client import close_redis, get_redis
from app.core.security import decode_admin_token
from app.routers import (
    accounts,
    admin,
    analysis,
    auth,
    engines,
    explorer,
    games,
    insights,
    intuition,
    openings,
    play,
    prep,
    puzzles,
    reports,
    studies,
    tablebase,
    training,
    users,
)
from app.ws import analysis as ws_analysis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s [api] %(message)s",
)
log = logging.getLogger(__name__)


def _warn_unencrypted_backends() -> None:
    """
    Say so, loudly, when production traffic to Postgres or Redis is in clear.

    Not a refusal: TLS is legitimately absent when the database is reached over
    a unix socket, a private VPC link, or a sidecar that terminates it - and a
    hard failure would strand those deployments. But the default DSNs in this
    repository are plaintext, and a managed database reached over the public
    internet without sslmode=require hands every query, and the password that
    opened the connection, to anything on the path.
    """
    if not settings.is_production:
        return

    dsn = settings.DATABASE_URL
    local = any(host in dsn for host in ("@localhost", "@127.0.0.1", "@postgres"))
    if not local and "ssl" not in dsn.lower():
        log.warning(
            "DATABASE_URL has no TLS setting and does not look local. Append "
            "?ssl=require (asyncpg) unless the link is already encrypted."
        )
    if settings.REDIS_URL.startswith("redis://") and not any(
        host in settings.REDIS_URL for host in ("@localhost", "@127.0.0.1", "//redis:")
    ):
        log.warning(
            "REDIS_URL is not rediss:// and does not look local. Redis carries "
            "rate-limit state and the engine queue; use TLS and a password."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting ChessRabbit API (env=%s)", settings.ENVIRONMENT)
    _warn_unencrypted_backends()
    yield
    await close_redis()
    await engine.dispose()
    log.info("Shutdown complete")


app = FastAPI(
    title="ChessRabbit API",
    description="Chess database, engine analysis, and opening explorer",
    version="0.1.0",
    lifespan=lifespan,
    # The interactive docs enumerate every route, parameter and schema in the
    # product, including the admin surface - a map of what to attack and what
    # each endpoint expects, served to anyone who guesses /docs. The schema is
    # still generated in-process (app.openapi() works, and CI asserts on it);
    # only the public routes serving it are withdrawn in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Credentialed CORS, so the origin list is an authorization boundary: any
# origin named here can drive the API as a logged-in user. The localhost
# wildcard is a dev-server convenience and must not survive into production,
# where a single malicious page on any localhost port would inherit the
# reader's session.
_cors_origins = [settings.APP_BASE_URL]
_cors_origin_regex: str | None = None
if not settings.is_production and not settings.LOCAL_MODE:
    _cors_origins.append("http://localhost:3000")
    _cors_origin_regex = r"http://localhost:\d+"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Every response this API produces is text: JSON bodies and PGN exports, both
# of which gzip to roughly a fifth of their size. Nothing here is served
# pre-compressed, and the responder skips any response that already carries a
# Content-Encoding, so a future binary/compressed endpoint cannot be
# double-encoded. Registered inside the security-header middleware, so those
# headers are stamped on the encoded response rather than compressed into it.
#
# minimum_size: below ~500 bytes the gzip frame costs more than it saves, and
# the tiny status/job responses on the hot analysis path stay untouched.
# compresslevel 5, not the library default 9: on a 300 KB insights payload
# level 9 spends several milliseconds of the event loop to beat level 5 by low
# single-digit percent, and this compresses inline on the async worker.
app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=5)

SECURITY_HEADERS = {
    # API responses are JSON consumed by fetch(), never rendered as a document,
    # so the policy can be maximally restrictive: nothing here should ever load
    # a subresource, run a script, or be framed. This matters because error
    # bodies and PGN exports echo user-supplied text, and a browser navigated
    # directly to such a URL would otherwise be free to interpret it.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    # Only meaningful over TLS, and pinning https from a plain-http dev server
    # would make localhost unreachable in that browser afterwards.
    if settings.is_production:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    The only thing a client learns from a crash is that one happened.

    Everything useful - the exception, the traceback, the path - goes to the
    server log under a correlation id, and the client gets that id and nothing
    else. A user reporting "error 3f2a9c1b" lets us find the exact stack
    without a stack trace ever having crossed the network, where it would name
    file paths, library versions and often the query that failed.
    """
    correlation_id = uuid.uuid4().hex[:12]
    log.exception(
        "Unhandled error [%s] on %s %s",
        correlation_id, request.method, request.url.path,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "internal_error",
                "message": "Something went wrong. Quote this reference if you "
                           "contact support.",
                "correlation_id": correlation_id,
            }
        },
    )


@app.get("/health", tags=["meta"])
async def health(authorization: str | None = Header(default=None)):
    """
    Liveness + dependency check. Used by Docker healthchecks and uptime monitors.

    Anonymous callers get the verdict and nothing else. Which dependency is
    down, which third-party circuit has tripped and what version is running are
    all useful to an operator and equally useful to somebody choosing when to
    attack: "database unreachable" is an invitation, and a version string is a
    lookup into a CVE list. The status CODE carries everything a health probe
    needs, so no monitoring breaks; the detail moves behind an admin token.
    """
    db_ok = redis_ok = False

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        log.warning("Health: database unreachable")

    try:
        await get_redis().ping()
        redis_ok = True
    except Exception:
        log.warning("Health: redis unreachable")

    healthy = db_ok and redis_ok
    code = 200 if healthy else 503
    body: dict = {"status": "ok" if healthy else "degraded"}

    detailed = not settings.is_production
    if not detailed and authorization and authorization.lower().startswith("bearer "):
        detailed = decode_admin_token(authorization.split(" ", 1)[1].strip()) is not None

    if detailed:
        body |= {
            "database": db_ok,
            "redis": redis_ok,
            # Third-party circuits, per process. A tripped one is not an
            # unhealthy API - the whole point is that the rest of the service
            # keeps serving - so it never changes the status code. It is here
            # because "Lichess import looks broken" is otherwise invisible
            # until somebody reads the logs.
            "dependencies": snapshot_all(),
            "version": app.version,
        }

    return JSONResponse(status_code=code, content=body)






@app.get("/open-source", tags=["meta"])
async def open_source_credits(request: Request):
    """Attribution also available in THIRD_PARTY_NOTICES.md."""
    payload = await cached_json("meta:open-source", 3600, _credits_payload)
    return etag_response(request, payload, max_age=3600, public=True)


async def _credits_payload() -> dict:
    return {
        "stockfish": {
            "license": "GPL-3.0",
            "source": "https://github.com/official-stockfish/Stockfish",

            "note": "Local UCI process; bundled with the Windows app and installed from Debian packages in Docker.",
        },
        "lc0": {"license": "GPL-3.0-or-later", "source": "https://github.com/LeelaChessZero/lc0", "note": "Optional local UCI engine; requires a network file."},
        "chessrabbit": {"license": "GPL-3.0"},
        "python-chess": {"license": "GPL-3.0", "note": "Server-side only"},
        "chess.js": {"license": "BSD-2-Clause"},
        "react-chessboard": {"license": "MIT"},
        "lichess-open-database": {
            "license": "CC0",
            "source": "https://database.lichess.org",
        },
    }


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(accounts.router)
app.include_router(games.router)
app.include_router(reports.router)
app.include_router(studies.router)
app.include_router(analysis.router)
app.include_router(explorer.router)
app.include_router(tablebase.router)
app.include_router(insights.router)
app.include_router(training.router)
app.include_router(puzzles.router)
app.include_router(play.router)
app.include_router(openings.router)
app.include_router(prep.router)
app.include_router(intuition.router)
app.include_router(admin.router)
app.include_router(ws_analysis.router)


app.include_router(engines.router)


@app.get("/app-config")
async def app_config():
    return {"local_mode": settings.LOCAL_MODE}
