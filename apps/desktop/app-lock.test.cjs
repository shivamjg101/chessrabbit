const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lock = require("./app-lock.cjs");

test("app lock setup, unlock, change, remove and malformed settings", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "chessrabbit-lock-"));
  try {
    assert.equal(lock.read(data), null);
    assert.throws(() => lock.save(data, "short"), /8 to 200/);
    lock.save(data, "first-password");
    assert(!fs.readFileSync(lock.filePath(data), "utf8").includes("first-password"));
    assert.equal(lock.verify(data, "wrong"), false);
    assert.equal(lock.verify(data, "first-password"), true);
    assert.throws(() => lock.save(data, "second-password", "wrong"), /incorrect/);
    lock.save(data, "second-password", "first-password");
    assert.equal(lock.verify(data, "first-password"), false);
    assert.equal(lock.verify(data, "second-password"), true);
    assert.throws(() => lock.remove(data, "wrong"), /incorrect/);
    lock.remove(data, "second-password");
    assert.equal(lock.read(data), null);
    fs.writeFileSync(lock.filePath(data), "{bad json");
    assert.throws(() => lock.read(data), /damaged/);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
