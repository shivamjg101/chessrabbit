const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { keyPath, localKey, encryptDump, stageRestore } = require("./backup.cjs");

test("encrypted backup round trip stages the same dump and rejects the wrong key", async () => {
  const directory = fs.mkdtempSync(path.join(__dirname, "../../.test-cache/backup-test-"));
  const dump = path.join(directory, "source.dump");
  const target = path.join(directory, "snapshot.crbackup");
  const data = path.join(directory, "data");
  const badData = path.join(directory, "bad-data");
  fs.mkdirSync(data);
  fs.mkdirSync(badData);
  const bytes = Buffer.alloc(1024 * 1024 + 13, 73);
  fs.writeFileSync(dump, bytes);
  const key = localKey(directory);
  assert.deepEqual(localKey(directory), key);
  await encryptDump(dump, target, key, { format: 1, tablebases: { path: "C:\\syzygy" } });
  const originalBackup = fs.readFileSync(target);
  await assert.rejects(encryptDump(dump, target, key, { format: 1 }));
  assert.deepEqual(fs.readFileSync(target), originalBackup);
  assert(!fs.readFileSync(target).includes(bytes.subarray(0, 64)));
  await assert.rejects(stageRestore(target, Buffer.alloc(32), badData));
  assert(!fs.existsSync(path.join(badData, "restore.dump")));
  await stageRestore(target, key, data);
  assert.deepEqual(fs.readFileSync(path.join(data, "restore.dump")), bytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "restore-config.json"))),
    { tablebases: { path: "C:\\syzygy" } });
  for (const file of [dump, target, keyPath(directory), path.join(data, "restore.dump"), path.join(data, "restore-config.json")]) fs.unlinkSync(file);
  fs.rmdirSync(data);
  fs.rmdirSync(badData);
  fs.rmdirSync(directory);
});
