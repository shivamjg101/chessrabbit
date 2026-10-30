import asyncio
import json
from pathlib import Path
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from registry import load_profiles, profile_fingerprint, start_profiles  # noqa: E402
from uci import EnginePool, StockfishEngine  # noqa: E402

FAKE = '''import json, sys
log = open(sys.argv[1], "a", encoding="utf-8")
for command in sys.stdin:
    log.write(command); log.flush()
    command = command.strip()
    if command == "uci":
        print("id name Test Leela")
        print("option name MultiPV type spin default 1 min 1 max 10")
        print("option name Backend type string default blas")
        print("option name WeightsFile type string default network.pb.gz")
        print("uciok", flush=True)
    elif command == "isready": print("readyok", flush=True)
    elif command.startswith("go"):
        if len(sys.argv) > 2: break
        print("info depth 8 multipv 1 score cp 32 pv e2e4 e7e5")
        print("bestmove e2e4", flush=True)
    elif command == "quit": break
'''


@pytest.mark.asyncio
async def test_uci_leela_options_search_and_missing_stockfish_options(tmp_path):
    script, log = tmp_path / "fake.py", tmp_path / "commands.txt"
    script.write_text(FAKE)
    engine = StockfishEngine(binary=sys.executable, args=[str(script), str(log)],
                             options={"Backend": "blas", "WeightsFile": "network.pb.gz"})
    try:
        await engine.start()
        result = [item async for item in engine.analyse("test-fen", depth=8, movetime_ms=500)]
        assert result[-1]["move"] == "e2e4"
        commands = log.read_text()
        assert "setoption name Backend value blas" in commands
        assert "setoption name WeightsFile value network.pb.gz" in commands
        assert "go depth 8 movetime 500" in commands
        assert "Skill Level" not in commands and "name Hash" not in commands
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_engine_exit_is_reported_as_failure(tmp_path):
    script, log = tmp_path / "fake.py", tmp_path / "commands.txt"
    script.write_text(FAKE)
    engine = StockfishEngine(binary=sys.executable, args=[str(script), str(log), "exit"])
    try:
        await engine.start()
        with pytest.raises(RuntimeError, match="exited"):
            async for _ in engine.analyse("test-fen"):
                pass
    finally:
        await engine.close()


def test_network_contents_options_and_profile_id_partition_cache(tmp_path):
    weights = tmp_path / "net.pb.gz"
    weights.write_bytes(b"first network")
    profile = {"id": "lc0", "options": {"WeightsFile": str(weights)}}
    first = profile_fingerprint(profile, "Lc0")
    weights.write_bytes(b"second network")
    assert profile_fingerprint(profile, "Lc0") != first
    assert profile_fingerprint({**profile, "id": "another"}, "Lc0") != profile_fingerprint(profile, "Lc0")


@pytest.mark.asyncio
async def test_missing_leela_network_does_not_prevent_other_engine_startup(tmp_path, monkeypatch):
    script = tmp_path / "fake.py"
    script.write_text(FAKE)
    config = tmp_path / "engines.json"
    config.write_text(json.dumps([
        {"id": "stockfish", "binary": sys.executable, "args": [str(script), str(tmp_path / "log")]},
        {"id": "lc0", "binary": "missing", "options": {"WeightsFile": str(tmp_path / "missing-net")}},
    ]))
    monkeypatch.setenv("ENGINES_CONFIG", str(config))
    pools, catalog = await start_profiles(1, 1, 16)
    try:
        assert catalog[0]["available"] and not catalog[1]["available"]
        assert set(pools) == {"stockfish"}
    finally:
        for pool in pools.values():
            await pool.stop()


def test_duplicate_profile_ids_are_rejected(tmp_path, monkeypatch):
    config = tmp_path / "engines.json"
    config.write_text('[{"id":"lc0"},{"id":"lc0"}]')
    monkeypatch.setenv("ENGINES_CONFIG", str(config))
    with pytest.raises(ValueError, match="duplicate"):
        load_profiles()


# Positions named "silent..." search until told to stop, like a deep search
# that prints nothing new for a while; a "go" during a search is not answered,
# as Stockfish waits for the running search before starting another.
SEARCHER = '''import sys
log = open(sys.argv[1], "a", encoding="utf-8")
fen, searching = None, False
for command in sys.stdin:
    log.write(command); log.flush()
    command = command.strip()
    if command == "uci":
        print("id name Test Searcher")
        print("option name MultiPV type spin default 1 min 1 max 10")
        print("option name Skill Level type spin default 20 min 0 max 20")
        print("uciok", flush=True)
    elif command == "isready": print("readyok", flush=True)
    elif command.startswith("position fen "): fen = command[len("position fen "):]
    elif command.startswith("go") and not searching:
        print(f"info depth 1 multipv 1 score cp 5 pv {fen}", flush=True)
        if fen.startswith("silent"): searching = True
        else: print(f"bestmove {fen}", flush=True)
    elif command == "stop" and searching:
        searching = False
        print(f"bestmove {fen}", flush=True)
    elif command == "quit": break
'''


@pytest_asyncio.fixture
async def searcher(tmp_path):
    script, log = tmp_path / "searcher.py", tmp_path / "commands.txt"
    script.write_text(SEARCHER)
    engine = StockfishEngine(binary=sys.executable, args=[str(script), str(log)])
    await engine.start()
    try:
        yield engine, log
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_stop_reaches_a_silent_engine_without_waiting_for_output(searcher):
    engine, _ = searcher
    stop = asyncio.Event()

    async def search():
        return [item async for item in engine.analyse("silent-a", stop_event=stop)]

    task = asyncio.create_task(search())
    await asyncio.sleep(0.2)
    stop.set()
    items = await asyncio.wait_for(task, timeout=5)
    assert items[-1] == {"type": "bestmove", "move": "silent-a"}


@pytest.mark.asyncio
async def test_abandoned_search_does_not_block_or_answer_the_next(searcher):
    engine, _ = searcher
    async for _ in engine.analyse("silent-a"):
        break  # the reader walks away mid-search
    await asyncio.sleep(0)  # let the abandoned generator close
    items = await asyncio.wait_for(_collect(engine.analyse("b")), timeout=5)
    assert items[-1] == {"type": "bestmove", "move": "b"}


@pytest.mark.asyncio
async def test_searches_keep_the_hash_and_send_only_changed_options(searcher):
    engine, log = searcher
    for fen in ("a", "b"):
        await _collect(engine.analyse(fen, multipv=2))
    await _collect(engine.analyse("c", multipv=1))
    commands = log.read_text()
    assert "ucinewgame" not in commands
    assert commands.count("setoption name MultiPV value 2") == 1
    assert commands.count("setoption name MultiPV value 1") == 1
    assert commands.count("setoption name Skill Level value 20") == 1


@pytest.mark.asyncio
async def test_weakened_play_stops_at_the_depth_its_move_is_picked(searcher, monkeypatch):
    import worker

    engine, log = searcher
    pool = EnginePool(size=1)
    pool._engines.append(engine)
    await pool._queue.put(engine)

    class Redis:
        def __init__(self):
            self.published = []

        async def publish(self, channel, message):
            self.published.append(json.loads(message))

    statuses = []

    async def set_job_status(conn, job_id, status, result=None, error=None):
        statuses.append(status)

    monkeypatch.setattr(worker, "set_job_status", set_job_status)
    redis = Redis()
    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    await worker.handle_play_job(pool, redis, None, {"job_id": 1, "fen": fen, "skill": 4, "movetime": 300})
    await worker.handle_play_job(pool, redis, None, {"job_id": 2, "fen": fen, "skill": 20, "movetime": 300})
    commands = log.read_text()
    assert "go depth 5 movetime 300" in commands
    assert "go depth 20 movetime 300" in commands
    assert [m["type"] for m in redis.published] == ["done", "done"]
    assert statuses == ["running", "done", "running", "done"]


async def _collect(search):
    return [item async for item in search]
