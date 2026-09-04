import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const [releaseDirArg, outputPathArg] = process.argv.slice(2);
const releaseDir = releaseDirArg || "release-files";
const outputPath = outputPathArg || path.join(releaseDir, "downloads.json");
const baseUrl = (process.env.TAPPAD_DOWNLOAD_BASE_URL || "").replace(/\/+$/, "");
const releaseTag = process.env.TAPPAD_RELEASE_TAG || "";
const commit = process.env.GITHUB_SHA || "";

if (!baseUrl) {
  console.error("TAPPAD_DOWNLOAD_BASE_URL is required to build the download manifest.");
  process.exit(1);
}

const platformRules = [
  {
    platform: "linux",
    label: "Omarchy",
    extensions: [".tar.gz"],
  },
];

const files = readdirSync(releaseDir)
  .filter((file) => file !== path.basename(outputPath))
  .map((file) => {
    const filePath = path.join(releaseDir, file);
    return {
      file,
      filePath,
      size: statSync(filePath).size,
    };
  });

const downloads = platformRules
  .map((rule) => {
    let artifact;

    for (const extension of rule.extensions) {
      const matches = files.filter(({ file }) => file.endsWith(extension)).sort((a, b) => a.file.localeCompare(b.file));

      if (matches.length > 0) {
        artifact = matches[0];
        break;
      }
    }

    if (!artifact) {
      return null;
    }

    return {
      platform: rule.platform,
      label: rule.label,
      file: artifact.file,
      size: artifact.size,
      url: `${baseUrl}/latest/${encodeURIComponent(artifact.file)}`,
    };
  })
  .filter(Boolean);

if (downloads.length === 0) {
  console.error(`No downloadable artifacts found in ${releaseDir}.`);
  process.exit(1);
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      version: releaseTag,
      commit,
      generatedAt: new Date().toISOString(),
      downloads,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${outputPath}`);
