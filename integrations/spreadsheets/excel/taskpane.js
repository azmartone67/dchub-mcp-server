/* DC Hub for Excel: task pane (key entry). External file so the CSP needs no inline script. */
/* global Office, OfficeRuntime */
Office.onReady(function () {
  document.getElementById("save").onclick = async function () {
    var k = document.getElementById("k").value.trim();
    if (k) await OfficeRuntime.storage.setItem("dchub_api_key", k);
    else await OfficeRuntime.storage.removeItem("dchub_api_key");
    document.getElementById("s").textContent = (k ? "Key saved." : "Key cleared.") + " Recalculate (Ctrl+Alt+F9) to refresh.";
  };
});
