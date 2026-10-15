const bridge = window.chessrabbitLock;
const $ = (id) => document.getElementById(id);
const unlockMode = new URLSearchParams(location.search).get("mode") === "unlock";
let enabled = false;

function message(text, error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#F78A81" : "#A8D8AB";
}

async function render() {
  try {
    enabled = (await bridge.status()).enabled;
    $("title").textContent = unlockMode ? "Unlock ChessRabbit" : "App lock";
    $("description").textContent = unlockMode
      ? "Enter your app password to open your local chess workspace."
      : enabled ? "Change or remove the password required when ChessRabbit opens."
        : "Optional: require a password whenever ChessRabbit opens.";
    $("current-row").hidden = !unlockMode && !enabled;
    $("new-row").hidden = unlockMode;
    $("current").required = unlockMode || enabled;
    $("new").required = !unlockMode;
    $("confirm").required = !unlockMode;
    $("submit").textContent = unlockMode ? "Unlock" : enabled ? "Change password" : "Set password";
    $("remove").hidden = unlockMode || !enabled;
    $("close").hidden = unlockMode || !enabled;
    $("recovery").hidden = !unlockMode;
    (unlockMode || enabled ? $("current") : $("new")).focus();
  } catch {
    message("Could not read app lock settings. See the desktop guide to reset the lock.", true);
    $("submit").disabled = true;
  }
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  message("");
  if (!unlockMode && $("new").value !== $("confirm").value) return message("Passwords do not match.", true);
  $("submit").disabled = true;
  try {
    const result = unlockMode
      ? await bridge.unlock($("current").value)
      : await bridge.save($("new").value, $("current").value);
    if (!result.ok) return message(result.message, true);
    $("form").reset();
    if (!unlockMode) { message("App password saved. It will be required next launch."); await render(); }
  } catch { message("Could not update the app lock. Try again.", true); }
  finally { $("submit").disabled = false; }
});

$("remove").addEventListener("click", async () => {
  message("");
  if (!$("current").value) return message("Enter your current password first.", true);
  const result = await bridge.remove($("current").value).catch(() => ({ ok:false, message:"Could not remove app lock." }));
  if (!result.ok) return message(result.message, true);
  $("form").reset();
  message("App lock removed. Your games were kept.");
  await render();
});

$("close").addEventListener("click", () => bridge.close());
render();
