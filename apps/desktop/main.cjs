const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const backup = require("./backup.cjs");
const lock = require("./app-lock.cjs");

app.setName("ChessRabbit");
const dataArgument = process.argv.find((arg) => arg.startsWith("--data-dir="));
if (dataArgument) {
  const directory = path.resolve(dataArgument.slice(11));
  fs.mkdirSync(directory, { recursive: true });
  app.setPath("userData", directory);
}
const smoke = process.argv.includes("--smoke-test");
const controlToken = randomBytes(48).toString("hex");
let backend, window, lockWindow, origin, quitting = false, backendExited = false, backingUp = false;
let servicesStarting = false, failedUnlocks = 0, retryUnlockAt = 0;
const lockPage = path.join(__dirname, "app-lock.html");

function lockSender(event, settings = false) {
  const owner = settings ? lockWindow : window;
  const address = event.sender.getURL();
  if (!owner || event.sender !== owner.webContents ||
      new URL(address).pathname !== new URL(pathToFileURL(lockPage)).pathname ||
      (settings ? !origin : !!origin)) throw new Error("App lock action is unavailable here");
}

ipcMain.handle("lock:status", (event) => {
  lockSender(event, event.sender === lockWindow?.webContents);
  return { enabled: !!lock.read(app.getPath("userData")) };
});
ipcMain.handle("lock:unlock", (event, password) => {
  lockSender(event);
  if (servicesStarting) return { ok: false, message: "ChessRabbit is opening. Please wait." };
  if (Date.now() < retryUnlockAt) return { ok: false, message: "Too many attempts. Try again in 30 seconds." };
  if (!lock.verify(app.getPath("userData"), password)) {
    if (++failedUnlocks >= 5) { failedUnlocks = 0; retryUnlockAt = Date.now() + 30000; }
    return { ok: false, message: "Incorrect app password." };
  }
  failedUnlocks = 0;
  servicesStarting = true;
  startServices().catch((error) => failure(error.stack || error.message));
  return { ok: true };
});
ipcMain.handle("lock:save", (event, password, currentPassword) => {
  lockSender(event, true);
  try { lock.save(app.getPath("userData"), password, currentPassword); setMenu(); return { ok: true }; }
  catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle("lock:remove", (event, currentPassword) => {
  lockSender(event, true);
  try { lock.remove(app.getPath("userData"), currentPassword); setMenu(); return { ok: true }; }
  catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle("lock:close", (event) => {
  lockSender(event, true);
  if (!lock.read(app.getPath("userData"))) throw new Error("Set an app password first");
  app.quit();
});

function openExternal(url) {
  try {
    const target = new URL(url);
    if (target.protocol === "https:" && !target.username && !target.password) shell.openExternal(target.href);
  } catch { /* Invalid destinations are ignored. */ }
}

async function control(endpoint, body, timeout = 90000) {
  const response = await fetch(`${origin}/desktop/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${controlToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || "The desktop service could not complete the request");
  return result;
}

async function makeBackup(destination, quiet = false) {
  if (!origin) throw new Error("Wait for local services to start before backing up");
  if (backingUp) throw new Error("A backup is already running");
  backingUp = true;
  let dump;
  try {
    const key = backup.localKey(app.getPath("userData"));
    dump = (await control("backup", undefined, 660000)).dump;
    const data = path.join(app.getPath("userData"), "local");
    if (path.dirname(path.resolve(dump)) !== path.resolve(data)) throw new Error("Unexpected snapshot location");
    const tablebasesFile = path.join(data, "tablebases.json");
    const tablebases = fs.existsSync(tablebasesFile) ? JSON.parse(fs.readFileSync(tablebasesFile, "utf8")) : {};
    await backup.encryptDump(dump, destination, key, { format: 1, tablebases });
    if (!quiet) await dialog.showMessageBox(window, { type: "info", title: "Backup saved",
      message: "Encrypted backup saved", detail: `Keep your recovery key separate from the backup. Export it from File → Export recovery key.\n${destination}` });
  } finally {
    if (dump) await fs.promises.unlink(dump).catch(() => {});
    backingUp = false;
  }
}

async function saveBackup() {
  const picked = await dialog.showSaveDialog(window, { title: "Save encrypted ChessRabbit backup",
    defaultPath: `ChessRabbit-${new Date().toISOString().slice(0, 10)}.crbackup`,
    filters: [{ name: "ChessRabbit backup", extensions: ["crbackup"] }] });
  if (picked.canceled || !picked.filePath) return;
  try { await makeBackup(picked.filePath); }
  catch (error) { await dialog.showMessageBox(window, { type: "error", title: "Backup failed", message: error.message }); }
}

async function exportBackupKey() {
  const file = backup.keyPath(app.getPath("userData"));
  if (!fs.existsSync(file)) {
    await dialog.showMessageBox(window, { type: "info", message: "Create a backup first to generate a recovery key." });
    return;
  }
  const picked = await dialog.showSaveDialog(window, { title: "Export recovery key to a separate safe location",
    defaultPath: "ChessRabbit-recovery.key", filters: [{ name: "Recovery key", extensions: ["key"] }] });
  if (picked.canceled || !picked.filePath) return;
  try {
    fs.copyFileSync(file, picked.filePath, fs.constants.COPYFILE_EXCL);
    await dialog.showMessageBox(window, { type: "info", message: "Recovery key exported",
      detail: "Keep this file separate from your encrypted backups. Anyone with both can read the backup." });
  } catch (error) { await dialog.showMessageBox(window, { type: "error", message: error.message }); }
}

async function restoreBackup() {
  const selected = await dialog.showOpenDialog(window, { title: "Choose a ChessRabbit backup",
    filters: [{ name: "ChessRabbit backup", extensions: ["crbackup"] }], properties: ["openFile"] });
  if (selected.canceled) return;
  const choice = await dialog.showMessageBox(window, { type: "warning", title: "Restore backup",
    message: "Replace the active workspace with this backup?",
    detail: "ChessRabbit will close. On your next launch it restores into a new database and keeps the current database as a local rollback copy. Changes since the backup will not appear in the restored workspace.",
    buttons: ["Cancel", "Use this computer's key", "Choose recovery key"], defaultId: 0, cancelId: 0 });
  if (choice.response === 0) return;
  let keyFile = backup.keyPath(app.getPath("userData"));
  if (choice.response === 2 || !fs.existsSync(keyFile)) {
    const selectedKey = await dialog.showOpenDialog(window, { title: "Choose the recovery key for this backup",
      properties: ["openFile"], filters: [{ name: "Recovery key", extensions: ["key"] }] });
    if (selectedKey.canceled) return;
    keyFile = selectedKey.filePaths[0];
  }
  try {
    await backup.stageRestore(selected.filePaths[0], backup.readKey(keyFile), path.join(app.getPath("userData"), "local"));
    await dialog.showMessageBox(window, { type: "info", message: "Restore staged",
      detail: "ChessRabbit will close now. Open it again to finish restoring the backup." });
    app.quit();
  } catch (error) { await dialog.showMessageBox(window, { type: "error", title: "Restore failed", message: error.message }); }
}

async function chooseBackupFolder() {
  const selected = await dialog.showOpenDialog(window, { title: "Choose a folder for daily encrypted snapshots",
    properties: ["openDirectory"] });
  if (selected.canceled) return;
  fs.writeFileSync(path.join(app.getPath("userData"), "backup-folder.json"),
    JSON.stringify({ path: selected.filePaths[0], lastBackup: 0 }));
  await scheduledBackup();
}

async function stopFolderBackups() {
  const config = path.join(app.getPath("userData"), "backup-folder.json");
  if (fs.existsSync(config)) fs.unlinkSync(config);
  await dialog.showMessageBox(window, { type: "info", message: "Daily folder backups stopped",
    detail: "Existing encrypted backups and your recovery key were kept." });
}

async function scheduledBackup() {
  const configFile = path.join(app.getPath("userData"), "backup-folder.json");
  if (!origin || !fs.existsSync(configFile) || backingUp) return;
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  if (Date.now() - config.lastBackup < 24 * 60 * 60 * 1000) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await makeBackup(path.join(config.path, `ChessRabbit-${stamp}.crbackup`), true);
    config.lastBackup = Date.now();
    fs.writeFileSync(configFile, JSON.stringify(config));
  } catch (error) { console.error("Scheduled backup failed:", error); }
}

async function addEngine(leela) {
  if (!origin) return;
  const executable = await dialog.showOpenDialog(window, {
    title: leela ? "Choose your Leela Chess Zero executable" : "Choose a UCI engine executable",
    filters: [{ name: "Windows executable", extensions: ["exe"] }], properties: ["openFile"],
  });
  if (executable.canceled) return;
  const binary = executable.filePaths[0];
  const profile = {
    id: leela ? "lc0" : `uci-${createHash("sha256").update(binary).digest("hex").slice(0, 12)}`,
    name: leela ? "Leela Chess Zero" : path.basename(binary, ".exe"), binary,
  };
  if (leela) {
    const network = await dialog.showOpenDialog(window, {
      title: "Choose the Leela neural network file", properties: ["openFile"],
      filters: [{ name: "Leela network", extensions: ["gz", "pb"] }],
    });
    if (network.canceled) return;
    profile.options = { WeightsFile: network.filePaths[0] };
  }
  try {
    await control("engines", profile);
    await dialog.showMessageBox(window, { type: "info", title: "Engine ready",
      message: `${profile.name} is ready`, detail: "Open Analysis settings and select this engine. Its files must remain at the location you chose." });
  } catch (error) {
    await dialog.showMessageBox(window, { type: "error", title: "Could not start engine", message: error.message });
  }
}

async function chooseTablebases() {
  if (!origin) return;
  const selected = await dialog.showOpenDialog(window, {
    title: "Choose a folder containing Syzygy .rtbw and .rtbz files",
    properties: ["openDirectory"],
  });
  if (selected.canceled) return;
  try {
    const result = await control("tablebases", { path: selected.filePaths[0] });
    await dialog.showMessageBox(window, { type: "info", title: "Tablebases ready",
      message: `${result.files} Syzygy files found`, detail: "Exact endgame probes are now available in Analysis. Keep this folder in place." });
  } catch (error) {
    await dialog.showMessageBox(window, { type: "error", title: "Could not use tablebases", message: error.message });
  }
}

function openLockSettings() {
  if (!origin || lockWindow) { lockWindow?.focus(); return; }
  lockWindow = new BrowserWindow({ parent: window, modal: true, width: 480, height: 610,
    minWidth: 420, minHeight: 540, title: "ChessRabbit app lock", backgroundColor: "#EBD9BC",
    autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  lockWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  lockWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  lockWindow.on("closed", () => { lockWindow = null; });
  lockWindow.loadFile(lockPage, { query: { mode: "settings" } });
}

function setMenu() {
  // A locked window must not expose backup keys, data folders, or native controls.
  if (!origin) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "File", submenu: [{ role: "quit" }] }]));
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Open data folder", click: () => shell.openPath(path.join(app.getPath("userData"), "local")) },
      { label: "App lock…", enabled: !!origin, click: openLockSettings },
      { label: "Lock and close", enabled: !!origin && fs.existsSync(lock.filePath(app.getPath("userData"))), click: () => app.quit() },
      { type: "separator" },
      { label: "Save encrypted backup…", click: saveBackup },
      { label: "Restore backup…", click: restoreBackup },
      { label: "Choose daily backup folder…", click: chooseBackupFolder },
      { label: "Stop daily folder backups", click: stopFolderBackups },
      { label: "Export recovery key…", click: exportBackupKey },
      { type: "separator" }, { role: "quit" },
    ] },
    { label: "Engines", submenu: [
      { label: "Add Leela Chess Zero…", click: () => addEngine(true) },
      { label: "Add UCI engine…", click: () => addEngine(false) },
      { label: "Choose Syzygy tablebases…", click: chooseTablebases },
      { type: "separator" },
      { label: "Leela downloads", click: () => openExternal("https://lczero.org/play/download/") },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [
      { label: "Donate", click: () => openExternal("https://buymeacoffee.com/shivamjg101") },
      { label: "Source code", click: () => openExternal("https://github.com/shivamjg101/chessrabbit/tree/codex/open-source-local-engines") },
      { label: "Licenses", click: () => shell.openPath(path.join(process.resourcesPath, "licenses")) },
      { label: "About ChessRabbit", click: () => dialog.showMessageBox(window, { title: "ChessRabbit", message: `ChessRabbit ${app.getVersion()}`,
        detail: "Free, open-source chess analysis and training. Stockfish 19 is included. Licensed under GPL-3.0. Your games stay on this computer." }) },
    ] },
  ]));
}

async function start() {
  setMenu();
  window = new BrowserWindow({ width: 1400, height: 920, minWidth: 760, minHeight: 600,
    show: !smoke, title: "ChessRabbit", backgroundColor: "#EBD9BC",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.on("closed", () => { window = null; });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  window.webContents.on("will-navigate", (event, url) => {
    if (!origin || new URL(url).origin !== origin) { event.preventDefault(); openExternal(url); }
  });
  if (lock.read(app.getPath("userData"))) {
    if (smoke) throw new Error("Smoke tests cannot bypass an enabled app lock");
    await window.loadFile(lockPage, { query: { mode: "unlock" } });
    return;
  }
  servicesStarting = true;
  await startServices();
}

async function startServices() {
  if (!servicesStarting || backend || origin) return;
  await window.loadFile(path.join(__dirname, "loading.html"));
  const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../dist/desktop-dev");
  const data = path.join(app.getPath("userData"), "local");
  fs.mkdirSync(data, { recursive: true });
  const log = fs.createWriteStream(path.join(data, "desktop.log"), { flags: "a" });
  backend = spawn(path.join(resources, "backend", "ChessRabbitBackend.exe"), ["--resources", resources, "--data-dir", data], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], cwd: data,
    env: { ...process.env, CHESSRABBIT_CONTROL_TOKEN: controlToken },
  });
  backend.stderr.pipe(log);
  const startupTimer = setTimeout(() => failure("Local services did not start within three minutes. See desktop.log in the data folder."), 180000);
  const lines = readline.createInterface({ input: backend.stdout });
  lines.on("line", async (line) => {
    let message;
    try { message = JSON.parse(line); } catch { log.write(`${line}\n`); return; }
    if (message.type !== "ready" || origin || quitting) return;
    const url = new URL(message.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return;
    clearTimeout(startupTimer);
    origin = url.origin;
    console.log(`CHESSRABBIT_READY ${origin}`);
    setMenu();
    try {
      if (smoke) {
        await require("./smoke.cjs").run(origin, data, control);
        console.log("CHESSRABBIT_SMOKE_PASSED");
        window.close();
      } else {
        await window.loadURL(`${origin}/app/`);
        scheduledBackup();
        setInterval(scheduledBackup, 60 * 60 * 1000).unref();
      }
    } catch (error) { failure(error.stack || error.message); }
  });
  backend.on("error", (error) => { clearTimeout(startupTimer); failure(error.message); });
  backend.on("exit", (code) => {
    backendExited = true;
    clearTimeout(startupTimer);
    log.end();
    if (!quitting) failure(`Local services stopped (exit ${code}). Your data has been preserved. See ${path.join(data, "desktop.log")}.`);
  });
}

function failure(message) {
  console.error(message);
  if (!smoke && !quitting) dialog.showErrorBox("ChessRabbit could not start", message);
  process.exitCode = 1;
  if (!backend || backendExited) app.exit(1);
  else app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(start).catch((error) => failure(error.stack));
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !backend || backendExited) return;
    event.preventDefault();
    quitting = true;
    if (window && !window.isDestroyed()) window.hide();
    const stop = async () => {
      if (origin) await control("shutdown").catch(() => {});
      backend.stdin.end();
      await new Promise((resolve) => {
        if (backendExited) return resolve();
        const timer = setTimeout(() => { backend.kill(); resolve(); }, 20000);
        backend.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      app.exit(process.exitCode || 0);
    };
    stop().catch(() => { backend.kill(); app.exit(1); });
  });
}
