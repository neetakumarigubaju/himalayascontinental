import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.resolve(__dirname, "../public/media");
const R2_BASE_URL = "https://media.himalayascontinental.com/media";
const API_URL = "https://himalayascontinental.com/api/media?limit=200";

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 0) {
      return { status: "already_exists", size: stats.size };
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const fileStream = fs.createWriteStream(destPath);
  await pipeline(res.body, fileStream);
  const stats = fs.statSync(destPath);
  return { status: "downloaded", size: stats.size };
}

async function main() {
  console.log("Fetching media documents list from API...");
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch media list: ${res.statusText}`);
  }
  const data = await res.json();
  const docs = data.docs || [];
  console.log(`Found ${docs.length} media documents to process.\n`);

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalBytes = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const filename = doc.filename;
    if (!filename) continue;

    const fileUrl = `${R2_BASE_URL}/${encodeURIComponent(filename)}`;
    const destPath = path.join(TARGET_DIR, filename);

    process.stdout.write(`[${i + 1}/${docs.length}] ${filename}... `);

    try {
      const result = await downloadFile(fileUrl, destPath);
      if (result.status === "already_exists") {
        console.log(`already exists (${(result.size / 1024).toFixed(1)} KB)`);
        skippedCount++;
        totalBytes += result.size;
      } else {
        console.log(`downloaded (${(result.size / 1024).toFixed(1)} KB)`);
        successCount++;
        totalBytes += result.size;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failedCount++;
    }

    // Also download variants if present so existing DB references don't break
    if (doc.sizes && typeof doc.sizes === "object") {
      for (const [sizeName, sizeData] of Object.entries(doc.sizes)) {
        if (sizeData && sizeData.filename && sizeData.filename !== filename) {
          const variantFilename = sizeData.filename;
          const variantUrl = `${R2_BASE_URL}/${encodeURIComponent(variantFilename)}`;
          const variantDest = path.join(TARGET_DIR, variantFilename);
          try {
            const vRes = await downloadFile(variantUrl, variantDest);
            if (vRes.status === "downloaded") {
              totalBytes += vRes.size;
            }
          } catch {
            // Variant might not exist in R2, safe to ignore
          }
        }
      }
    }
  }

  console.log("\n==========================================");
  console.log(`Download finished!`);
  console.log(`Successfully downloaded: ${successCount}`);
  console.log(`Already existed:         ${skippedCount}`);
  console.log(`Failed:                  ${failedCount}`);
  console.log(`Total data in storage:   ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Destination directory:   ${TARGET_DIR}`);
  console.log("==========================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
