const header = document.querySelector(".site-header");
const downloadButton = document.querySelector("[data-download-trigger]");
const downloadStatus = document.querySelector("[data-download-status]");

const updateHeader = () => {
  header?.classList.toggle("scrolled", window.scrollY > 24);
};

const setStatus = (message, state = "neutral") => {
  if (!downloadStatus) {
    return;
  }

  downloadStatus.textContent = message;
  downloadStatus.classList.toggle("error", state === "error");
};

const startDownload = async () => {
  downloadButton.disabled = true;
  setStatus("Preparing the Omarchy download...");

  try {
    const response = await fetch("/api/downloads", {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "The Omarchy download is not ready yet.");
    }

    const download = Array.isArray(payload.downloads)
      ? payload.downloads.find((candidate) => candidate.platform === "linux")
      : null;

    if (!download?.url) {
      throw new Error("The Omarchy download is not available yet.");
    }

    setStatus("Starting the Omarchy download...");
    window.location.href = download.url;
  } catch (error) {
    setStatus(error.message || "The Omarchy download is not available yet.", "error");
  } finally {
    downloadButton.disabled = false;
  }
};

window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();
downloadButton?.addEventListener("click", startDownload);
