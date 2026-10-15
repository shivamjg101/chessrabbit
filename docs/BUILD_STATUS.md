# Community edition scope

Implemented: no payment routes, subscription checks or paid features; GPL-3.0 license; automatic local sessions; localhost Docker setup; a 0.1.4 Windows desktop build with direct board access, public Lichess/Chess.com username imports and an optional app lock; local PostgreSQL, Stockfish and encrypted backups; selectable UCI profiles; optional CPU Lc0 image; native Windows/GPU worker instructions; cache separation by engine/network; backend, web and installed-app regression tests. The public download remains the 0.1.2 prerelease until a newer release is published.

Not included: bundled neural networks, preloaded reference/puzzle datasets, durable acknowledged job retries or GPU-enabled Docker images.

Validation commands are in [Development](DEVELOPMENT_GUIDE.md). Run [Local smoke tests](../scripts/smoke_local.py) after starting Docker.
