import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import https from "node:https";

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          https.get(response.headers.location, (redirectRes) => {
            if (redirectRes.statusCode && redirectRes.statusCode >= 400) {
              reject(new Error(`Failed to download ${url}: ${redirectRes.statusCode}`));
              return;
            }
            redirectRes.pipe(file);
            file.on("finish", () => file.close(() => resolve(destPath)));
          }).on("error", reject);
          return;
        }
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => reject(err));
      });
  });
}

function toSafeFilename(base) {
  return base.replace(/[^a-z0-9._-]/gi, "_");
}

async function* readJsonl(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      yield JSON.parse(line);
    } catch (e) {
      console.warn("Skipping invalid JSONL line:", line);
    }
  }
}

async function fetchImageAsBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image url: ${res.status} ${res.statusText}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function extractBase64FromDataUrl(possibleDataUrl) {
  const match =
    typeof possibleDataUrl === "string" &&
    possibleDataUrl.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/i);
  return match ? match[1] : null;
}

async function extractImageBufferFromOpenRouterResponse(json) {
  const choice = json?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

  // Handle the documented `message.images` array with data URLs
  const images = message?.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      if (img?.type === "image_url" && img.image_url?.url) {
        const url = img.image_url.url;
        const b64 = extractBase64FromDataUrl(url);
        if (b64) return Buffer.from(b64, "base64");
        // Fallback: if it's an http(s) URL
        const buf = await fetchImageAsBuffer(url);
        return buf;
      }
      if (typeof img === "string") {
        const b64 = extractBase64FromDataUrl(img);
        if (b64) return Buffer.from(b64, "base64");
      }
    }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      // Case 1: explicit output image with base64
      if (part?.type === "output_image") {
        const base64 = part.image_base64 || part.b64_json || part.base64 || (typeof part.data === "string" ? part.data : null);
        if (base64) return Buffer.from(base64, "base64");
        if (typeof part.data === "string") {
          const b64 = extractBase64FromDataUrl(part.data);
          if (b64) return Buffer.from(b64, "base64");
        }
      }
      // Case 2: image hosted at a URL we can fetch
      if (part?.type === "image_url" && part.image_url?.url) {
        const buf = await fetchImageAsBuffer(part.image_url.url);
        return buf;
      }
      // Case 3: sometimes models return a string data URL inside a "text" part
      if (part?.type === "text" && typeof part.text === "string") {
        const b64 = extractBase64FromDataUrl(part.text);
        if (b64) return Buffer.from(b64, "base64");
      }
    }
  }

  if (typeof content === "string") {
    const b64 = extractBase64FromDataUrl(content);
    if (b64) return Buffer.from(b64, "base64");
  }

  throw new Error("OpenRouter response did not include an image");
}

async function enhanceImageWithOpenRouter({ promptText, imageUrl, backgroundDataUrl }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY env var");

  const referer = process.env.OPENROUTER_SITE_URL || "https://localhost";
  const title = process.env.OPENROUTER_SITE_NAME || "banosser";

  const body = {
    model: "google/gemini-2.5-flash-image-preview",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: imageUrl } },
          ...(backgroundDataUrl
            ? [{ type: "image_url", image_url: { url: backgroundDataUrl } }]
            : []),
        ],
      },
    ],
    modalities: ['image', 'text']
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": referer,
      "X-Title": title,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter error: ${res.status} ${res.statusText} - ${errText}`);
  }

  const json = await res.json();
  return await extractImageBufferFromOpenRouterResponse(json);
}

async function main() {
  const projectRoot = process.cwd();
  const jsonlPath = path.resolve(projectRoot, "fragrances_with_images_fast.jsonl");
  const workingDir = path.resolve(projectRoot, "working");
  const finalDir = path.resolve(projectRoot, "final");
  // Optional CLI: --limit N
  const limitArgIndex = process.argv.indexOf("--limit");
  const limit = limitArgIndex !== -1 ? Number(process.argv[limitArgIndex + 1]) : undefined;
  // Background image as data URL if present
  const bgPath = path.resolve(projectRoot, "bg.png");
  let backgroundDataUrl = undefined;
  if (fs.existsSync(bgPath)) {
    try {
      const bgBuffer = fs.readFileSync(bgPath);
      const b64 = bgBuffer.toString("base64");
      backgroundDataUrl = `data:image/png;base64,${b64}`;
    } catch {}
  } else {
    console.warn("Background image ./bg.png not found. Proceeding without background.")
  }

  ensureDirSync(workingDir);
  ensureDirSync(finalDir);

  const outputs = [];
  let index = 0;
  let processed = 0;
  for await (const item of readJsonl(jsonlPath)) {
    index += 1;
    const brand = item.brand || "brand";
    const name = item.name || `item_${index}`;
    const sourceUrl = item.imageUrl;
    if (!sourceUrl) {
      console.warn(`Skipping item without imageUrl: ${brand} ${name}`);
      continue;
    }

    const baseName = toSafeFilename(`${brand}_${name}`);
    const workingFile = path.join(workingDir, `${baseName}.jpg`);
    const finalFile = path.join(finalDir, `${baseName}.jpg`);

    try {
      console.log(`Began working on: ${baseName}.jpg`);
      await downloadFile(sourceUrl, workingFile);

      const promptText = "Place the provided fragrance bottle into a professional studio shot on a clean solid background (white or light neutral), with soft diffused, even lighting, realistic reflections and gentle shadows. Keep original product, label and shape unchanged. Remove noise, glare, harsh shadows, distracting elements. Ensure the final image is a widescreen 16:9 product image, with the product centered. Do NOT stretch or distort the product; extend the background canvas to maintain 16:9. Return only the final enhanced image.";

      const enhancedBuffer = await enhanceImageWithOpenRouter({
        promptText,
        imageUrl: sourceUrl,
        backgroundDataUrl,
      });

      fs.writeFileSync(finalFile, enhancedBuffer);

      outputs.push({
        ...item,
        localUpdatedFile: finalFile,
      });
      console.log(`Completed work: ${baseName}.jpg`);
      processed += 1;
      if (limit && processed >= limit) break;
    } catch (err) {
      console.error(`Failed (OpenRouter): ${brand} - ${name}:`, err.message);
    }
  }

  const dataJsonPath = path.join(finalDir, "data.json");
  fs.writeFileSync(dataJsonPath, JSON.stringify(outputs, null, 2));
  console.log(`Wrote ${outputs.length} records to ${dataJsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


