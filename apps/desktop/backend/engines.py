"""Run the existing queue consumers in the desktop API's event loop."""

import asyncio
import json
from pathlib import Path

import psycopg

from database import write_json
from registry import CATALOG_KEY, profile_fingerprint, start_profiles
from uci import EnginePool
import worker


class DesktopEngines:
    def __init__(self, redis, config: Path):
        self.redis = redis
        self.config = config
        self.pools = {}
        self.catalog = []
        self.tasks = {}
        self.heartbeat = None
        self.reconciliation = None
        self.lock = asyncio.Lock()

    def consume(self, engine_id, pool):
        self.tasks[engine_id] = [asyncio.create_task(worker.consume(
            i, [f"q:{engine_id}:interactive", f"q:{engine_id}:batch"], pool, self.redis,
        )) for i in range(pool.size)]

    async def start(self):
        worker.shutdown = asyncio.Event()
        self.pools, self.catalog = await start_profiles(1, worker.THREADS, worker.HASH_MB)
        await self.redis.set(CATALOG_KEY, json.dumps(self.catalog), ex=90)
        await worker.recover_jobs(self.redis, set(self.pools))
        self.heartbeat = asyncio.create_task(worker.advertise(self.redis, self.catalog))
        self.reconciliation = asyncio.create_task(worker.reconcile_jobs(self.redis, self.pools))
        for engine_id, pool in self.pools.items():
            self.consume(engine_id, pool)
        if "stockfish" not in self.pools:
            raise RuntimeError(f"Bundled Stockfish could not start: {self.catalog}")

    async def add(self, profile):
        async with self.lock:
            async with await psycopg.AsyncConnection.connect(worker.DATABASE_URL) as conn:
                cursor = await conn.execute("SELECT count(*) FROM analysis_jobs WHERE status IN ('queued','running')")
                if (await cursor.fetchone())[0]:
                    raise ValueError("Finish or stop the current analysis before changing engines.")
            pool = EnginePool(size=1, threads=worker.THREADS, hash_mb=worker.HASH_MB,
                              binary=profile["binary"], options=profile.get("options", {}))
            try:
                await pool.start()
                pool.cache_key = profile_fingerprint(profile, pool.version)
                old_tasks = self.tasks.pop(profile["id"], [])
                for task in old_tasks:
                    task.cancel()
                await asyncio.gather(*old_tasks, return_exceptions=True)
                if profile["id"] in self.pools:
                    await self.pools[profile["id"]].stop()
                profiles = json.loads(self.config.read_text(encoding="utf-8"))
                profiles = [p for p in profiles if p["id"] != profile["id"]] + [profile]
                write_json(self.config, profiles)
            except BaseException:
                await pool.stop()
                raise
            self.pools[profile["id"]] = pool
            self.catalog[:] = [p for p in self.catalog if p["id"] != profile["id"]] + [{
                "id": profile["id"], "name": profile["name"], "available": True,
                "version": pool.version, "cache_key": pool.cache_key,
            }]
            await self.redis.set(CATALOG_KEY, json.dumps(self.catalog), ex=90)
            self.consume(profile["id"], pool)
            return self.catalog

    async def stop(self):
        worker.shutdown.set()
        tasks = [t for group in self.tasks.values() for t in group]
        if self.heartbeat:
            tasks.append(self.heartbeat)
        if self.reconciliation:
            tasks.append(self.reconciliation)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for pool in self.pools.values():
            await pool.stop()
