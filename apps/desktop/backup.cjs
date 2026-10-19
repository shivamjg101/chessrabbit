const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const MAGIC = Buffer.from("CRBKP001");
const HEADER_SIZE = MAGIC.length + 12;
const TAG_SIZE = 16;

function keyPath(userData) { return path.join(userData, "backup.key"); }

function readKey(file) {
  const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("Invalid ChessRabbit recovery key");
  return key;
}

function localKey(userData) {
  const file = keyPath(userData);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
  }
  return readKey(file);
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    offset += bytesWritten;
  }
}

async function encryptDump(dump, destination, key, metadata = {}) {
  if (fs.existsSync(destination)) throw new Error("Choose a new backup filename; an existing backup will not be replaced");
  const temporary = `${destination}.${crypto.randomBytes(6).toString("hex")}.part`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.from(JSON.stringify(metadata), "utf8");
  if (header.length > 1024 * 1024) throw new Error("Backup metadata is too large");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  const output = await fs.promises.open(temporary, "wx");
  try {
    await writeAll(output, Buffer.concat([MAGIC, iv]));
    await writeAll(output, cipher.update(Buffer.concat([size, header])));
    for await (const chunk of fs.createReadStream(dump)) await writeAll(output, cipher.update(chunk));
    await writeAll(output, cipher.final());
    await writeAll(output, cipher.getAuthTag());
    await output.close();
    try {
      await fs.promises.link(temporary, destination);
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "ENOTSUP") throw error;
      await fs.promises.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
    }
    await fs.promises.unlink(temporary);
  } catch (error) {
    await output.close().catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function stageRestore(backup, key, data) {
  const stats = await fs.promises.stat(backup);
  if (stats.size < HEADER_SIZE + TAG_SIZE + 4) throw new Error("Backup file is incomplete");
  const input = await fs.promises.open(backup, "r");
  const prefix = Buffer.alloc(HEADER_SIZE);
  const tag = Buffer.alloc(TAG_SIZE);
  try {
    await input.read(prefix, 0, prefix.length, 0);
    await input.read(tag, 0, tag.length, stats.size - TAG_SIZE);
  } finally { await input.close(); }
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a ChessRabbit backup");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, prefix.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const temporary = path.join(data, `restore-${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    await pipeline(
      fs.createReadStream(backup, { start: HEADER_SIZE, end: stats.size - TAG_SIZE - 1 }),
      decipher, fs.createWriteStream(temporary, { flags: "wx" }),
    );
    const source = await fs.promises.open(temporary, "r");
    let metadata;
    let start;
    try {
      const size = Buffer.alloc(4);
      await source.read(size, 0, 4, 0);
      const length = size.readUInt32BE();
      if (length > 1024 * 1024 || length + 4 >= (await source.stat()).size) throw new Error("Invalid backup metadata");
      const bytes = Buffer.alloc(length);
      await source.read(bytes, 0, length, 4);
      metadata = JSON.parse(bytes.toString("utf8"));
      start = 4 + length;
    } finally { await source.close(); }
    if (!metadata || metadata.format !== 1) throw new Error("Unsupported backup version");
    const dump = path.join(data, "restore.dump");
    if (fs.existsSync(dump)) throw new Error("A restore is already pending; reopen ChessRabbit first");
    const pending = `${dump}.tmp`;
    try {
      await pipeline(fs.createReadStream(temporary, { start }), fs.createWriteStream(pending, { flags: "wx" }));
      await fs.promises.rename(pending, dump);
      await fs.promises.writeFile(path.join(data, "restore-config.json"),
        JSON.stringify({ tablebases: metadata.tablebases }), { flag: "wx" });
    } catch (error) {
      await fs.promises.unlink(pending).catch(() => {});
      await fs.promises.unlink(dump).catch(() => {});
      throw error;
    }
    return metadata;
  } finally { await fs.promises.unlink(temporary).catch(() => {}); }
}

module.exports = { keyPath, readKey, localKey, encryptDump, stageRestore };
