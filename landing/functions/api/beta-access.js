const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MANIFEST_KEY = "latest/downloads.json";
const SUPPORTED_PLATFORMS = new Set(["macos", "windows", "linux"]);

const json = (payload, init = {}) =>
  Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });

const normalizeBody = async (request) => {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error("Expected a JSON request.");
  }

  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  const useCase = String(body.useCase || "").trim();
  const platform = String(body.platform || "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Please enter a valid email.");
  }

  if (useCase.length < 8) {
    throw new Error("Please share a little more about how you plan to use TapPad.");
  }

  if (platform && !SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Please choose a supported desktop platform.");
  }

  return { email, useCase, platform };
};

const loadManifest = async (env) => {
  if (env.TAPPAD_DOWNLOADS_BUCKET) {
    const object = await env.TAPPAD_DOWNLOADS_BUCKET.get(MANIFEST_KEY);

    if (object) {
      return object.json();
    }
  }

  if (env.TAPPAD_DOWNLOAD_MANIFEST_URL) {
    const response = await fetch(env.TAPPAD_DOWNLOAD_MANIFEST_URL, {
      cf: { cacheTtl: 30, cacheEverything: true },
    });

    if (response.ok) {
      return response.json();
    }
  }

  throw new Error("Download links are not configured yet.");
};

const saveLead = async (env, lead) => {
  if (!env.TAPPAD_LEADS_BUCKET) {
    return;
  }

  const createdAt = new Date().toISOString();
  const day = createdAt.slice(0, 10);
  const requestId = crypto.randomUUID();
  const key = `beta-access/${day}/${createdAt.replace(/[:.]/g, "-")}-${requestId}.json`;

  await env.TAPPAD_LEADS_BUCKET.put(
    key,
    JSON.stringify(
      {
        ...lead,
        createdAt,
        requestId,
      },
      null,
      2,
    ),
    {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
    },
  );
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const lead = await normalizeBody(request);
    const manifest = await loadManifest(env);
    await saveLead(env, lead);
    const downloads = manifest.downloads || [];
    const download = lead.platform ? downloads.find((item) => item.platform === lead.platform) : null;

    return json({
      download: download || null,
      downloads,
      generatedAt: manifest.generatedAt || null,
      version: manifest.version || null,
    });
  } catch (error) {
    return json(
      {
        error: error.message || "Download access is not available yet.",
      },
      { status: 400 },
    );
  }
};

export const onRequest = () =>
  json(
    {
      error: "Use POST to request beta download access.",
    },
    { status: 405 },
  );
