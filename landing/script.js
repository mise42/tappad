const header = document.querySelector(".site-header");
const downloadDialog = document.querySelector("[data-download-dialog]");
const betaAccessForm = document.querySelector("[data-beta-access-form]");
const betaAccessStatus = document.querySelector("[data-beta-access-status]");
const downloadButtons = document.querySelectorAll("[data-download-trigger]");
const closeDialogButton = document.querySelector("[data-dialog-close]");
const dialogTitle = document.querySelector("#download-dialog-title");
const downloadConfirmButton = document.querySelector("[data-download-confirm]");
const detectedCopy = document.querySelector("[data-detected-copy]");

const platformLabels = {
  macos: "Mac",
  windows: "Windows PC",
  linux: "Linux PC",
};

let selectedPlatform = "macos";

const updateHeader = () => {
  header.classList.toggle("scrolled", window.scrollY > 24);
};

const detectPlatform = () => {
  const platform = `${navigator.userAgentData?.platform || navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();

  if (platform.includes("mac")) {
    return "macos";
  }

  if (platform.includes("win")) {
    return "windows";
  }

  if (platform.includes("linux") || platform.includes("x11")) {
    return "linux";
  }

  return "";
};

const setStatus = (message, state = "neutral") => {
  if (!betaAccessStatus) {
    return;
  }

  betaAccessStatus.textContent = message;
  betaAccessStatus.classList.toggle("error", state === "error");
};

const getSelectedDownload = (downloads) => {
  if (!Array.isArray(downloads)) {
    return null;
  }

  return downloads.find((download) => download.platform === selectedPlatform) || downloads[0] || null;
};

const parseAccessResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Download access is not ready yet.");
  }

  const hasExplicitDownload = Object.prototype.hasOwnProperty.call(payload, "download");
  const selectedDownload = hasExplicitDownload ? payload.download : getSelectedDownload(payload.downloads);

  if (!selectedDownload?.url) {
    const platformLabel = platformLabels[selectedPlatform] || "desktop";
    throw new Error(`The ${platformLabel} download is not configured yet.`);
  }

  return selectedDownload;
};

const openDownloadDialog = (platform) => {
  selectedPlatform = platform;
  const platformLabel = platformLabels[platform] || "desktop";

  setStatus("");
  if (dialogTitle) {
    dialogTitle.textContent = `Download TapPad for ${platformLabel}`;
  }
  if (downloadConfirmButton) {
    downloadConfirmButton.textContent = "Submit & download";
  }

  if (downloadDialog?.showModal) {
    downloadDialog.showModal();
    betaAccessForm?.querySelector("input[name='email']")?.focus();
  }
};

const markDetectedPlatform = () => {
  const detectedPlatform = detectPlatform();
  const detectedLabel = platformLabels[detectedPlatform];

  if (detectedCopy) {
    detectedCopy.textContent = detectedLabel
      ? "Looking for another system? Choose a different version below."
      : "Choose the version for the computer you want to control.";
  }

  for (const button of downloadButtons) {
    const isDetected = button.dataset.platform === detectedPlatform;
    const note = button.querySelector("[data-platform-note]");

    button.classList.toggle("detected", isDetected);
    button.style.order = isDetected ? "-1" : "0";

    if (note) {
      note.textContent = detectedPlatform && isDetected ? "Detected" : "";
    }
  }
};

window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();
markDetectedPlatform();

for (const button of downloadButtons) {
  button.addEventListener("click", () => {
    openDownloadDialog(button.dataset.platform || "macos");
  });
}

closeDialogButton?.addEventListener("click", () => {
  downloadDialog?.close();
});

downloadDialog?.addEventListener("click", (event) => {
  if (event.target === downloadDialog) {
    downloadDialog.close();
  }
});

betaAccessForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(betaAccessForm);
  const email = String(formData.get("email") || "").trim();
  const useCase = String(formData.get("useCase") || "").trim();
  const platformLabel = platformLabels[selectedPlatform] || "desktop";

  if (!email || !useCase) {
    setStatus("Please add your email and expected use case.", "error");
    return;
  }

  downloadConfirmButton.disabled = true;
  downloadConfirmButton.textContent = "Preparing download...";
  setStatus("Saving your beta access request...");

  try {
    const response = await fetch("/api/beta-access", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, useCase, platform: selectedPlatform }),
    });

    const download = await parseAccessResponse(response);
    setStatus(`Starting the ${platformLabel} download...`);
    window.location.href = download.url;
    window.setTimeout(() => downloadDialog?.close(), 300);
  } catch (error) {
    setStatus(error.message || "Downloads are not available yet.", "error");
  } finally {
    downloadConfirmButton.disabled = false;
    downloadConfirmButton.textContent = "Submit & download";
  }
});
