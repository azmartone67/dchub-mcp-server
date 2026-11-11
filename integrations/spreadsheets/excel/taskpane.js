/* DC Hub for Excel: task pane (welcome + key entry). External file so the CSP needs no inline script.
 * The welcome section is static, so it stays on screen after a key is saved. */
/* global Office, OfficeRuntime */
Office.onReady(async function () {
  var status = document.getElementById("s");
  try {
    if (await OfficeRuntime.storage.getItem("dchub_api_key")) status.textContent = "A key is saved on this device.";
  } catch (e) { /* storage unavailable: leave the status empty */ }
  document.getElementById("save").onclick = async function () {
    var k = document.getElementById("k").value.trim();
    if (k) await OfficeRuntime.storage.setItem("dchub_api_key", k);
    else await OfficeRuntime.storage.removeItem("dchub_api_key");
    status.textContent = (k ? "Key saved." : "Key cleared.") + " Recalculate (Ctrl+Alt+F9) to refresh, then try the formulas above.";
  };
});
