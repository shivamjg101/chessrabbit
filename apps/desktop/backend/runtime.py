"""Entry point frozen by PyInstaller and launched only by the desktop shell."""

import argparse
import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading

from database import LocalDatabase, write_json
from windows_job import contain_processes


async def run(resources: Path, data: Path):
    contain_processes()
    data.mkdir(parents=True, exist_ok=True)
    # Freeze cwd inside the private workspace, so a downloaded .env cannot be read.
    os.chdir(data)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    database = LocalDatabase(resources, data)
    web_socket = socket.socket()
    try:
        web_socket.bind(("127.0.0.1", database.config.get("web_port", 0)))
    except OSError:
        web_socket.bind(("127.0.0.1", 0))
    web_socket.listen(128)
    web_socket.setblocking(False)
    origin = f"http://127.0.0.1:{web_socket.getsockname()[1]}"
    database.config["web_port"] = web_socket.getsockname()[1]
    write_json(data / "database.json", database.config)
    engine_config = data / "engines.json"
    profiles = json.loads(engine_config.read_text(encoding="utf-8")) if engine_config.exists() else []
    stockfish = resources / "runtime" / "stockfish" / "stockfish-windows-x86-64-universal.exe"
    profiles = [p for p in profiles if p["id"] != "stockfish"]
    write_json(engine_config, [{"id": "stockfish", "name": "Stockfish", "binary": str(stockfish)}, *profiles])
    tablebase_config = data / "tablebases.json"
    tablebases = json.loads(tablebase_config.read_text(encoding="utf-8")) if tablebase_config.exists() else {}
    os.environ.update({
        "DATABASE_URL": database.dsn.replace("postgresql://", "postgresql+asyncpg://", 1),
        "APP_BASE_URL": origin, "LOCAL_MODE": "true", "ENVIRONMENT": "desktop",
        "JWT_SECRET": database.config["jwt_secret"], "ENGINES_CONFIG": str(engine_config),
        "ENGINE_WORKERS": "1", "ENGINE_THREADS_PER_JOB": "2", "ENGINE_HASH_MB": "64",
        "SYZYGY_PATH": tablebases.get("path", ""),
    })
    token = os.environ.pop("CHESSRABBIT_CONTROL_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Desktop control token is missing")
    try:
        await asyncio.to_thread(database.start, resources / "migrations")
        profiles = json.loads(engine_config.read_text(encoding="utf-8"))
        profiles = [p for p in profiles if p["id"] != "stockfish"]
        write_json(engine_config, [{"id": "stockfish", "name": "Stockfish", "binary": str(stockfish)}, *profiles])
        tablebases = json.loads(tablebase_config.read_text(encoding="utf-8")) if tablebase_config.exists() else {}
        os.environ["SYZYGY_PATH"] = tablebases.get("path", "")
        import fakeredis
        from fastapi import FastAPI, HTTPException, Request
        from fastapi.responses import RedirectResponse
        from fastapi.staticfiles import StaticFiles
        import uvicorn
        from app.core.redis_client import configure_redis
        configure_redis(fakeredis.FakeAsyncRedis(decode_responses=True))
        from app.core.redis_client import get_redis
        from app.main import app as api
        # API uses asyncpg; the existing worker needs psycopg's unadorned DSN.
        os.environ["DATABASE_URL"] = database.dsn
        from engines import DesktopEngines
        engines = DesktopEngines(get_redis(), engine_config)

        @asynccontextmanager
        async def lifespan(application):
            async with api.router.lifespan_context(api):
                try:
                    await engines.start()
                    yield
                finally:
                    await engines.stop()

        application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
        server = uvicorn.Server(uvicorn.Config(application, log_level="warning", access_log=False,
                                              host="127.0.0.1", proxy_headers=False, timeout_graceful_shutdown=5))

        def authorize(request):
            if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
                raise HTTPException(403, "Desktop control access required")

        @application.post("/desktop/shutdown")
        async def shutdown(request: Request):
            authorize(request)
            server.should_exit = True
            return {"ok": True}

        @application.post("/desktop/engines")
        async def add_engine(request: Request):
            authorize(request)
            profile = await request.json()
            import re
            if (not isinstance(profile, dict) or not re.fullmatch(r"[a-z0-9_-]{1,40}", profile.get("id", ""))
                    or profile["id"] == "stockfish" or not Path(profile.get("binary", "")).is_file()
                    or not isinstance(profile.get("name"), str)):
                raise HTTPException(400, "Choose a local UCI engine executable")
            try:
                return await engines.add(profile)
            except Exception as exc:
                raise HTTPException(400, str(exc)) from exc

        @application.post("/desktop/tablebases")
        async def set_tablebases(request: Request):
            authorize(request)
            payload = await request.json()
            path = payload.get("path") if isinstance(payload, dict) else None
            if not isinstance(path, str):
                raise HTTPException(400, "Choose a Syzygy tablebase folder")
            from app.core.config import settings
            from app.routers.analysis import _tablebase
            if path:
                folder = Path(path).resolve()
                if not folder.is_dir():
                    raise HTTPException(400, "Tablebase folder does not exist")
                files = [p for p in folder.iterdir() if p.suffix.lower() in (".rtbw", ".rtbz")]
                if not files:
                    raise HTTPException(400, "No .rtbw or .rtbz Syzygy files in that folder")
                import chess.syzygy
                try:
                    with chess.syzygy.open_tablebase(str(folder)):
                        pass
                except (OSError, ValueError) as exc:
                    raise HTTPException(400, "Could not open Syzygy tablebases") from exc
                path = str(folder)
            else:
                files = []
            previous = _tablebase() if settings.SYZYGY_PATH else None
            _tablebase.cache_clear()
            if previous is not None:
                previous.close()
            settings.SYZYGY_PATH = path
            write_json(tablebase_config, {"path": path})
            return {"path": path, "files": len(files)}

        @application.post("/desktop/backup")
        async def make_backup(request: Request):
            authorize(request)
            try:
                dump = await asyncio.to_thread(database.dump)
            except Exception as exc:
                logging.exception("Database backup failed")
                raise HTTPException(500, "Could not create a database snapshot") from exc
            return {"dump": str(dump)}

        @application.get("/")
        @application.get("/login/")
        @application.get("/register/")
        @application.get("/forgot/")
        @application.get("/reset/")
        @application.get("/verify/")
        async def desktop_workspace():
            return RedirectResponse("/app/", status_code=302)

        application.mount("/api", api)
        application.mount("/", StaticFiles(directory=resources / "web", html=True))

        async def ready():
            while not server.started and not server.should_exit:
                await asyncio.sleep(0.1)
            if server.started:
                print(json.dumps({"type": "ready", "url": origin}), flush=True)

        def watch_parent():
            while os.read(sys.stdin.fileno(), 1):
                pass
            server.should_exit = True

        readiness = asyncio.create_task(ready())
        threading.Thread(target=watch_parent, daemon=True).start()
        try:
            await server.serve(sockets=[web_socket])
        finally:
            readiness.cancel()
    finally:
        web_socket.close()
        await asyncio.to_thread(database.stop)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--resources", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(run(args.resources.resolve(), args.data_dir.resolve()))
    except Exception:
        logging.exception("Desktop startup failed; local data has been preserved")
        sys.exit(1)
