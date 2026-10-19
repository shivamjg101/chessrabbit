import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from registry import load_profiles, profile_fingerprint, start_profiles  # noqa: E402
from uci import StockfishEngine  # noqa: E402

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
async def test_same_game_search_keeps_hash_until_the_next_game(tmp_path):
    script, log = tmp_path / "fake.py", tmp_path / "commands.txt"
    script.write_text(FAKE)
    engine = StockfishEngine(binary=sys.executable, args=[str(script), str(log)])
    try:
        await engine.start()
        for new_game in (True, False, True):
            _ = [item async for item in engine.analyse("test-fen", depth=8, new_game=new_game)]
        assert log.read_text().splitlines().count("ucinewgame") == 2
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
async def test_chess960_option_is_enabled_for_variant_and_reset_for_standard(tmp_path):
    script, log = tmp_path / "fake.py", tmp_path / "commands.txt"
    script.write_text(FAKE.replace(
        'print("option name MultiPV type spin default 1 min 1 max 10")',
        'print("option name MultiPV type spin default 1 min 1 max 10")\n        print("option name UCI_Chess960 type check default false")',
    ))
    engine = StockfishEngine(binary=sys.executable, args=[str(script), str(log)])
    try:
        await engine.start()
        _ = [item async for item in engine.analyse("test-fen", chess960=True)]
        _ = [item async for item in engine.analyse("test-fen")]
        commands = log.read_text()
        assert commands.index("setoption name UCI_Chess960 value true") < commands.index("setoption name UCI_Chess960 value false")
    finally:
        await engine.close()


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
