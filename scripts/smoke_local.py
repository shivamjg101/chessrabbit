"""Smoke test a running local Docker stack; creates one tiny test game."""

import json
import time
import uuid
import urllib.error
import urllib.request

API = "http://localhost:8000"
token = None


def request(path, body=None, method="GET"):
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(API + path, data=data, headers=headers, method=method), timeout=10) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def wait_for_job(job_id):
    for _ in range(120):
        job = request(f"/analysis/jobs/{job_id}")
        if job["status"] == "done":
            return job
        if job["status"] in {"failed", "canceled"}:
            raise RuntimeError(f"Analysis job {job_id} ended as {job['status']}")
        time.sleep(1)
    raise TimeoutError("Analysis did not finish within 120 seconds")


def main():
    global token
    for _ in range(60):
        try:
            if request("/app-config")["local_mode"]:
                break
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(2)
    else:
        raise RuntimeError("Local API did not become ready")
    token = request("/auth/local-session", method="POST")["access_token"]
    me = request("/me")
    assert me["local_mode"] and me["daily_limit"] is None and "plan" not in me
    for _ in range(60):
        engines = request("/engines")
        if any(engine["id"] == "stockfish" and engine["available"] for engine in engines):
            break
        time.sleep(2)
    else:
        raise RuntimeError("Stockfish did not become ready")
    job = request("/analysis/position", {"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "engine": "stockfish", "depth": 8, "multipv": 2}, "POST")
    assert len(wait_for_job(job["job_id"])["result"]["lines"]) == 2
    # A different game each run: a run that died before its cleanup would
    # otherwise leave a copy behind, and the next import is a skipped duplicate.
    pgn = f'[White "Local"]\n[Black "Smoke test {uuid.uuid4().hex[:8]}"]\n[Result "*"]\n\n1. e4 e5 *'
    imported = request("/games", {"pgn": pgn}, "POST")
    assert imported["imported"] == 1
    game_id = imported["game_ids"][0]
    try:
        review = request(f"/analysis/game/{game_id}?engine=stockfish&depth=8", method="POST")
        assert wait_for_job(review["job_id"])["result"]["accuracy"]
    finally:
        request(f"/games/{game_id}", method="DELETE")
    print("Local session, Stockfish position analysis and game review passed")


if __name__ == "__main__":
    main()
