const MANIFEST_KEY = "latest/downloads.json";

const json = (payload, init = {}) =>
  Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "public, max-age=30",
      ...(init.headers || {}),
    },
  });

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

export const onRequestGet = async ({ env }) => {
  try {
    const manifest = await loadManifest(env);

    return json({
      downloads: manifest.downloads || [],
      generatedAt: manifest.generatedAt || null,
      version: manifest.version || null,
    });
  } catch (error) {
    return json(
      { error: error.message || "Downloads are not available yet." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const onRequest = () =>
  json(
    { error: "Use GET to list public downloads." },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
