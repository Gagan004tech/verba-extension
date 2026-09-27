console.log("[VERBA] permission.js loaded.");

document.getElementById("grant-btn").addEventListener("click", async () => {
  console.log("[VERBA] Allow Microphone Access clicked.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    console.log("[VERBA] Microphone permission granted.");
    alert("Microphone permission granted! You can now close this tab and return to the side panel.");
    window.close();
  } catch (err) {
    console.error("[VERBA] Microphone permission denied:", err);
    alert("Permission denied or microphone not found: " + err.message);
  }
});