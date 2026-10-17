const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const filePath = (data) => path.join(data, "app-lock.json");

function read(data) {
  const file = filePath(data);
  if (!fs.existsSync(file)) return null;
  let record;
  try { record = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("App lock settings are damaged. See the desktop guide to reset the lock."); }
  if (record?.version !== 1 || !/^[0-9a-f]{32}$/.test(record.salt) || !/^[0-9a-f]{128}$/.test(record.hash)) {
    throw new Error("App lock settings are damaged. See the desktop guide to reset the lock.");
  }
  return record;
}

function verify(data, password) {
  const record = read(data);
  if (!record || typeof password !== "string" || password.length > 200) return false;
  const actual = scryptSync(password, Buffer.from(record.salt, "hex"), 64);
  return timingSafeEqual(actual, Buffer.from(record.hash, "hex"));
}

function save(data, password, currentPassword) {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new Error("Use a password of 8 to 200 characters.");
  }
  if (read(data) && !verify(data, currentPassword)) throw new Error("Current password is incorrect.");
  fs.mkdirSync(data, { recursive: true });
  const salt = randomBytes(16);
  const record = { version: 1, salt: salt.toString("hex"), hash: scryptSync(password, salt, 64).toString("hex") };
  const temporary = `${filePath(data)}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filePath(data));
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function remove(data, currentPassword) {
  if (!read(data)) throw new Error("App lock is not enabled.");
  if (!verify(data, currentPassword)) throw new Error("Current password is incorrect.");
  fs.unlinkSync(filePath(data));
}

module.exports = { filePath, read, verify, save, remove };
