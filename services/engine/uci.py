"""
UCI process wrapper for Stockfish, Lc0 and other locally configured engines.
See THIRD_PARTY_NOTICES.md before redistributing engine binaries or networks.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


class _WindowsReader:
    """
    Thread-backed pipes also work on psycopg's Windows selector loop.

    One reader thread per engine feeds a queue. A thread-pool hop per line cost
    more than the line itself during a search, and a read abandoned by a
    timeout kept running and swallowed the line it was waiting for.
    """

    def __init__(self, pipe):
        loop = asyncio.get_running_loop()
        self._lines: asyncio.Queue[bytes] = asyncio.Queue()

        def pump():
            with pipe:
                while True:
                    try:
                        raw = pipe.readline()
                    except (OSError, ValueError):
                        raw = b""
                    try:
                        loop.call_soon_threadsafe(self._lines.put_nowait, raw)
                    except RuntimeError:  # the event loop has closed
                        return
                    if not raw:
                        return

        threading.Thread(target=pump, name="uci-reader", daemon=True).start()

    async def readline(self):
        raw = await self._lines.get()
        if not raw:
            self._lines.put_nowait(raw)  # stay at EOF for any later reader
        return raw


class _WindowsWriter:
    def __init__(self, pipe):
        self.pipe = pipe

    def write(self, data):
        self.pipe.write(data)

    async def drain(self):
        # A UCI command is a few dozen bytes into a pipe the engine reads
        # continuously, so flushing inline is cheaper than a thread hop.
        self.pipe.flush()


class _WindowsProcess:
    def __init__(self, binary: str, args: list[str]):
        self.process = subprocess.Popen(
            [binary, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        self.stdin = _WindowsWriter(self.process.stdin)
        self.stdout = _WindowsReader(self.process.stdout)

    @property
    def returncode(self):
        return self.process.poll()

    async def wait(self):
        code = await asyncio.to_thread(self.process.wait)
        # Closing stdin flushes whatever was still buffered for it - a "quit"
        # sent to an engine that had already died. On Windows that flush
        # fails with EINVAL, not BrokenPipeError. The reader thread closes
        # stdout itself once it reaches EOF.
        try:
            self.process.stdin.close()
        except OSError:
            pass
        return code

    def kill(self):
        self.process.kill()


@dataclass
class EvalLine:
    """One MultiPV line of engine output, normalized."""

    depth: int
    multipv: int
    cp: int | None = None          # centipawns, side-to-move perspective
    mate: int | None = None        # mate in N (signed)
    pv: list[str] = field(default_factory=list)
    nodes: int | None = None
    nps: int | None = None

    def to_white_perspective(self, white_to_move: bool) -> EvalLine:
        """Engine reports from side-to-move view. Storage is always White's view."""
        if white_to_move:
            return self
        return EvalLine(
            depth=self.depth,
            multipv=self.multipv,
            cp=-self.cp if self.cp is not None else None,
            mate=-self.mate if self.mate is not None else None,
            pv=self.pv,
            nodes=self.nodes,
            nps=self.nps,
        )

    def as_dict(self) -> dict:
        return {
            "depth": self.depth,
            "multipv": self.multipv,
            "cp": self.cp,
            "mate": self.mate,
            "pv": self.pv,
            "nodes": self.nodes,
            "nps": self.nps,
        }


def parse_info_line(line: str) -> EvalLine | None:
    """
    Parse a single UCI 'info' line by token scanning.

    UCI fields appear in arbitrary order and 'pv' runs to end of line, so a
    left-to-right token walk is the correct approach (regex is brittle here).
    Returns None for lines carrying no score (currmove, string, etc).
    """
    if not line.startswith("info"):
        return None

    tokens = line.split()
    depth = nodes = nps = None
    multipv = 1
    cp = mate = None
    pv: list[str] = []

    i = 1  # skip the literal "info"
    while i < len(tokens):
        tok = tokens[i]

        if tok == "depth" and i + 1 < len(tokens):
            depth = int(tokens[i + 1])
            i += 2
        elif tok == "seldepth" and i + 1 < len(tokens):
            i += 2  # parsed but unused; consume so the value isn't misread as a keyword
        elif tok == "multipv" and i + 1 < len(tokens):
            multipv = int(tokens[i + 1])
            i += 2
        elif tok == "nodes" and i + 1 < len(tokens):
            nodes = int(tokens[i + 1])
            i += 2
        elif tok == "nps" and i + 1 < len(tokens):
            nps = int(tokens[i + 1])
            i += 2
        elif tok == "score" and i + 2 < len(tokens):
            kind, value = tokens[i + 1], tokens[i + 2]
            if kind == "cp":
                cp = int(value)
            elif kind == "mate":
                mate = int(value)
            i += 3
        elif tok == "pv":
            pv = tokens[i + 1:]  # pv always runs to end of line
            break
        elif tok == "string":
            return None  # "info string ..." is free-form engine chatter
        else:
            i += 1

    if cp is None and mate is None:
        return None  # no evaluation in this line (e.g. currmove updates)

    return EvalLine(
        depth=depth or 0,
        multipv=multipv,
        cp=cp,
        mate=mate,
        pv=pv,
        nodes=nodes,
        nps=nps,
    )


class StockfishEngine:
    """
    Async wrapper around one Stockfish process.

    Usage:
        engine = StockfishEngine()
        await engine.start()
        async for line in engine.analyse(fen, depth=20, multipv=3):
            ...
        await engine.close()
    """

    def __init__(
        self,
        binary: str | None = None,
        threads: int = 2,
        hash_mb: int = 256,
        args: list[str] | None = None,
        options: dict | None = None,
    ) -> None:
        # Debian's package installs to /usr/games, which slim images omit from PATH.
        self.binary = (
            binary
            or os.getenv("STOCKFISH_PATH")
            or shutil.which("stockfish")
            or ("/usr/games/stockfish" if os.path.exists("/usr/games/stockfish") else "stockfish")
        )
        self.threads = threads
        self.hash_mb = hash_mb
        self.args = args or []
        self.options = options or {}
        self.supported_options: set[str] = set()
        self.proc: asyncio.subprocess.Process | _WindowsProcess | None = None
        self.version: str = "unknown"
        self._lock = asyncio.Lock()
        self._sent_options: dict[str, str] = {}
        # True from "go" until its "bestmove" has been read. A caller that stops
        # iterating early leaves the search running, and its output would
        # otherwise answer the next request.
        self._searching = False

    # ---------- process lifecycle ----------

    async def start(self) -> None:
        if os.name == "nt":
            self.proc = _WindowsProcess(self.binary, self.args)
        else:
            self.proc = await asyncio.create_subprocess_exec(
                self.binary, *self.args, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        self.supported_options.clear()
        self._sent_options.clear()
        self._searching = False
        await self._send("uci")
        while True:
            line = await asyncio.wait_for(self._readline(), timeout=30)
            if line is None:
                raise RuntimeError("Engine died during UCI handshake")
            if line.startswith("id name"):
                self.version = line[len("id name ") :].strip()
            if line.startswith("option name ") and " type " in line:
                self.supported_options.add(line[12:].split(" type ", 1)[0])
            if line.strip() == "uciok":
                break

        await self.set_option("Threads", self.threads)
        await self.set_option("Hash", self.hash_mb)
        for name, value in self.options.items():
            if name not in self.supported_options:
                raise ValueError(f"Engine does not support option {name}")
            await self.set_option(name, value)
        await self._ready()
        log.info("Engine ready: %s (threads=%d hash=%dMB)", self.version, self.threads, self.hash_mb)

    async def close(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                await self._send("quit")
                await asyncio.wait_for(self.proc.wait(), timeout=5)
            # OSError, not just BrokenPipeError/ConnectionResetError: writing
            # to a dead engine's pipe on Windows is EINVAL, which escaped here
            # and replaced "Engine exited during analysis" with a raw OSError.
            except (asyncio.TimeoutError, OSError):
                self.proc.kill()
                await self.proc.wait()
        self.proc = None

    async def restart(self) -> None:
        """Engines crash. Supervisors must be boring and ruthless."""
        log.warning("Restarting engine process")
        await self.close()
        await self.start()

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    # ---------- low-level IO ----------

    async def _send(self, cmd: str) -> None:
        if "\n" in cmd or "\r" in cmd:
            raise ValueError("UCI commands must occupy a single line")
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("Engine not started")
        self.proc.stdin.write((cmd + "\n").encode())
        await self.proc.stdin.drain()

    async def set_option(self, name: str, value) -> None:
        if name in self.supported_options:
            value = str(value).lower() if isinstance(value, bool) else str(value)
            # Options are re-applied before every search; only changes go out.
            if self._sent_options.get(name) == value:
                return
            await self._send(f"setoption name {name} value {value}")
            self._sent_options[name] = value

    async def _readline(self) -> str | None:
        if not self.proc or not self.proc.stdout:
            return None
        raw = await self.proc.stdout.readline()
        if not raw:
            return None
        return raw.decode(errors="replace").rstrip("\n")

    async def _ready(self) -> None:
        await self._send("isready")
        while True:
            line = await asyncio.wait_for(self._readline(), timeout=60)
            if line is None:
                raise RuntimeError("Engine died waiting for readyok")
            if line.strip() == "readyok":
                return

    async def _finish_abandoned_search(self) -> None:
        """Stop a search nobody read to the end and discard its output."""
        try:
            await self._send("stop")
            while (line := await asyncio.wait_for(self._readline(), timeout=10)) is not None:
                if line.startswith("bestmove"):
                    self._searching = False
                    return
        except (asyncio.TimeoutError, OSError, RuntimeError):
            pass
        await self.restart()

    async def _stop_when_set(self, stop_event: asyncio.Event) -> None:
        """Send "stop" the moment the caller gives up, not at the next output line."""
        await stop_event.wait()
        try:
            await self._send("stop")
        except (OSError, RuntimeError):
            pass  # the engine is gone; the read loop reports that

    # ---------- analysis ----------

    async def analyse(
        self,
        fen: str,
        depth: int = 20,
        multipv: int = 1,
        movetime_ms: int | None = None,
        infinite: bool = False,
        stop_event: asyncio.Event | None = None,
        on_line: Callable[[EvalLine], None] | None = None,
        skill: int = 20,
    ) -> AsyncIterator[EvalLine | dict]:
        """
        Stream evaluation lines for a position.

        Yields EvalLine objects as they arrive, then a final
        {"type": "bestmove", "move": "e2e4"} dict.
        """
        async with self._lock:
            if not self.alive:
                await self.restart()
            if self._searching:
                await self._finish_abandoned_search()

            await self.set_option("MultiPV", max(1, multipv))
            # Always set Skill Level so a weakened play move never leaks into the
            # next full-strength analysis on this reused engine (20 = full).
            await self.set_option("Skill Level", max(0, min(20, skill)))
            # No "ucinewgame" + "isready" per search: ucinewgame empties the
            # hash table, so every position started cold although the next one
            # on the board shares most of its tree with the last. Commands are
            # processed in order, so nothing here needs a readyok round trip.
            await self._send(f"position fen {fen}")

            if infinite:
                await self._send("go infinite")
            elif movetime_ms:
                await self._send(f"go depth {depth} movetime {movetime_ms}")
            else:
                await self._send(f"go depth {depth}")
            self._searching = True

            stopper = asyncio.create_task(self._stop_when_set(stop_event)) if stop_event else None
            try:
                while True:
                    try:
                        line = await asyncio.wait_for(self._readline(), timeout=120)
                    except asyncio.TimeoutError:
                        log.error("Engine read timeout; killing process")
                        await self.close()
                        raise RuntimeError("Engine timed out during analysis")

                    if line is None:
                        log.error("Engine EOF; restarting")
                        await self.close()
                        raise RuntimeError("Engine exited during analysis")

                    if line.startswith("bestmove"):
                        self._searching = False
                        if stopper:
                            stopper.cancel()
                        parts = line.split()
                        yield {"type": "bestmove", "move": parts[1] if len(parts) > 1 else None}
                        return

                    ev = parse_info_line(line)
                    if ev is not None:
                        if on_line:
                            on_line(ev)
                        yield ev
            finally:
                if stopper:
                    stopper.cancel()


class EnginePool:
    """A pool of Stockfish processes. Acquire/release with an async context manager."""

    def __init__(self, size: int = 3, threads: int = 2, hash_mb: int = 256, **engine_kwargs) -> None:
        self.size = size
        self.threads = threads
        self.hash_mb = hash_mb
        self.engine_kwargs = engine_kwargs
        self.cache_key = "unknown"
        self._queue: asyncio.Queue[StockfishEngine] = asyncio.Queue()
        self._engines: list[StockfishEngine] = []

    async def start(self) -> None:
        engines = [StockfishEngine(threads=self.threads, hash_mb=self.hash_mb, **self.engine_kwargs)
                   for _ in range(self.size)]
        self._engines.extend(engines)
        # Side by side: each process spends most of its startup loading its
        # network, so a second one need not add to the app's startup time.
        for result in await asyncio.gather(*(eng.start() for eng in engines), return_exceptions=True):
            if isinstance(result, BaseException):
                raise result
        for eng in engines:
            await self._queue.put(eng)
        log.info("Engine pool started with %d processes", self.size)

    async def stop(self) -> None:
        for eng in self._engines:
            await eng.close()
        self._engines.clear()

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self) -> StockfishEngine:
                self.engine = await pool._queue.get()
                return self.engine

            async def __aexit__(self, *exc) -> None:
                await pool._queue.put(self.engine)

        return _Ctx()

    @property
    def version(self) -> str:
        return self._engines[0].version if self._engines else "unknown"
