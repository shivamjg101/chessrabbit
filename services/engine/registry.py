"""Trusted, on-disk engine profiles. Browser requests only contain a profile id."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from uci import EnginePool

CATALOG_KEY = "engines:catalog"


def load_profiles() -> list[dict]:
    config = os.getenv("ENGINES_CONFIG")
    if config:
        profiles = json.loads(Path(config).read_text(encoding="utf-8"))
    else:
        profiles = [
            {"id": "stockfish", "name": "Stockfish", "binary": os.getenv("STOCKFISH_PATH")},
            {"id": "lc0", "name": "Leela Chess Zero", "binary": os.getenv("LC0_PATH", "lc0"),
             "options": {"WeightsFile": os.getenv("LC0_WEIGHTS_PATH", "/engines/lc0/network.pb.gz")}},
        ]
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("Engine configuration must be a non-empty JSON array")
    ids = set()
    for profile in profiles:
        engine_id = profile.get("id", "")
        if not re.fullmatch(r"[a-z0-9_-]{1,40}", engine_id) or engine_id in ids:
            raise ValueError(f"Invalid or duplicate engine id: {engine_id}")
        ids.add(engine_id)
    return profiles


def profile_fingerprint(profile: dict, version: str) -> str:
    """Separate versions, options and neural network contents in the cache."""
    digest = hashlib.sha256(json.dumps(profile, sort_keys=True).encode())
    digest.update(version.encode())
    weights = profile.get("options", {}).get("WeightsFile")
    if weights:
        with Path(weights).open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    return f"{profile['id']}:{digest.hexdigest()[:24]}"


async def start_profiles(size: int, threads: int, hash_mb: int,
                         sizes: dict[str, int] | None = None) -> tuple[dict[str, EnginePool], list[dict]]:
    """`sizes` overrides `size` per profile id without entering its cache identity."""
    pools, catalog = {}, []
    for profile in load_profiles():
        entry = {"id": profile["id"], "name": profile.get("name", profile["id"]),
                 "available": False, "version": None, "cache_key": None}
        default = (sizes or {}).get(profile["id"], size)
        pool = EnginePool(size=max(1, int(profile.get("workers", default))), threads=threads,
                          hash_mb=hash_mb, binary=profile.get("binary"),
                          args=profile.get("args", []), options=profile.get("options", {}))
        try:
            weights = profile.get("options", {}).get("WeightsFile")
            if weights and not Path(weights).is_file():
                raise FileNotFoundError("Neural network file is missing; configure WeightsFile")
            await pool.start()
            pool.cache_key = profile_fingerprint(profile, pool.version)
            entry.update(available=True, version=pool.version, cache_key=pool.cache_key)
            pools[profile["id"]] = pool
        except Exception as exc:
            await pool.stop()
            entry["error"] = str(exc)
        catalog.append(entry)
    return pools, catalog
