"""
Endgame tablebase lookups through Lichess's public Syzygy service.

With seven pieces or fewer on the board, "who is winning" stops being an
opinion: the tablebase has the exact result of every legal move and how far
each one is from a zeroing move (DTZ) or mate (DTM). Engines are good at these
positions; the tablebase is right about them.

The tables themselves are 18 TB for seven pieces, which is why this asks
https://tablebase.lichess.ovh rather than shipping them. Like the live
explorer it is called server-side, so the browser never talks to a third-party
origin and there is one place to cache and rate-limit. Unlike the explorer it
needs no token, and its answers never change - a position solved today is
solved forever - so they are cached for a long time.

Only the board position leaves the machine, and only when the Tablebase tab is
open on a position with seven pieces or fewer that the Syzygy files on this
machine (SYZYGY_PATH) cannot answer.
"""

from __future__ import annotations

import json
import logging

import httpx

from app.core.breaker import CircuitOpen, breaker
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)

TABLEBASE_URL = "https://tablebase.lichess.ovh/standard"
MAX_PIECES = 7
_TIMEOUT = httpx.Timeout(6.0, connect=3.0, read=6.0)
_HEADERS = {"User-Agent": "ChessRabbit (https://github.com/shivamjg101/chessrabbit)"}
# A solved position stays solved; the TTL is only there so Redis can forget
# positions nobody asks about any more.
_CACHE_TTL = 86400 * 30
_CACHE_PREFIX = "tb:standard:"

# A shared free service; stay well under what it tolerates.
_breaker = breaker(
    "lichess-tablebase",
    failure_threshold=5,
    reset_after=30.0,
    slow_call_seconds=4.0,
    max_concurrency=4,
)


class TablebaseUnavailable(Exception):
    """Upstream errored, timed out, rate-limited us, or answered nonsense."""


async def _fetch(fen: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            res = await client.get(TABLEBASE_URL, params={"fen": fen})
    except httpx.HTTPError as exc:
        raise TablebaseUnavailable(
            "Cannot reach the Lichess tablebase. Check your internet connection and retry."
        ) from exc

    if res.status_code == 429:
        raise TablebaseUnavailable("The tablebase is busy. Give it a moment and retry.")
    if res.status_code != 200:
        raise TablebaseUnavailable(f"The tablebase answered HTTP {res.status_code}.")
    try:
        data = res.json()
    except ValueError as exc:
        raise TablebaseUnavailable("The tablebase sent a malformed answer.") from exc
    if not isinstance(data, dict) or not isinstance(data.get("moves"), list):
        raise TablebaseUnavailable("The tablebase sent a malformed answer.")
    return data


def cache_key(fen: str) -> str:
    """
    Placement, side, castling, en passant and the halfmove clock.

    The clock is kept, unlike in the explorer's key: with fifty-move-rule
    accounting, the same placement can be a win at clock 0 and a "cursed win"
    (a draw in practice) at clock 80. Only the fullmove number is irrelevant.
    """
    return _CACHE_PREFIX + " ".join(fen.split()[:5])


async def probe(fen: str) -> dict:
    """
    Lichess's raw answer for a position. Raises TablebaseUnavailable when it
    cannot be had and nothing is cached.
    """
    key = cache_key(fen)
    try:
        raw = await get_redis().get(key)
        if raw:
            return json.loads(raw)
    except Exception:  # the cache is best-effort
        pass

    try:
        data = await _breaker.call(_fetch, fen)
    except CircuitOpen as exc:
        raise TablebaseUnavailable(
            "The tablebase is temporarily unavailable. Please retry shortly."
        ) from exc

    try:
        await get_redis().setex(key, _CACHE_TTL, json.dumps(data))
    except Exception:
        pass
    return data
