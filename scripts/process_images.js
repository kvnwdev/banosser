import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import https from "node:https";

const streamPipeline = promisify(pipeline);

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
          // follow redirect
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

async function enhanceImageWithGemini(ai, inputBuffer, backgroundBase64) {
  const base64Image = inputBuffer.toString("base64");
  const prompt = [
    {
      text:
        "Place the provided fragrance bottle onto the provided background image to create a professional studio shot with a clean solid look (white or light neutral). Use soft, diffused, even lighting with realistic reflections and gentle shadows that match the background. Keep the original product, label, and shape unchanged. Remove noise, glare, harsh shadows, and distracting elements. Ensure the final image is a widescreen 16:9 product image (e.g., 1920x1080) with the product centered. Do NOT stretch or distort the product; extend or blend the background canvas as needed to maintain 16:9. Return only the final enhanced image.",
    },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Image,
      },
    },
    ...(backgroundBase64
      ? [
          {
            inlineData: {
              mimeType: "image/png",
              data: backgroundBase64,
            },
          },
        ]
      : []),
  ];

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image-preview",
    contents: prompt,
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  throw new Error("Gemini did not return an image");
}

async function main() {
  const projectRoot = process.cwd();
  const jsonlPath = path.resolve(projectRoot, "fragrances_with_images_fast.jsonl");
  const workingDir = path.resolve(projectRoot, "working");
  const finalDir = path.resolve(projectRoot, "final");
  // Optional CLI: --limit N
  const limitArgIndex = process.argv.indexOf("--limit");
  const limit = limitArgIndex !== -1 ? Number(process.argv[limitArgIndex + 1]) : undefined;
  // Background image
  const bgPath = path.resolve(projectRoot, "bg.png");
  let backgroundBase64 = undefined;
  if (fs.existsSync(bgPath)) {
    try {
      const bgBuffer = fs.readFileSync(bgPath);
      backgroundBase64 = bgBuffer.toString("base64");
    } catch {}
  } else {
    console.warn("Background image ./bg.png not found. Proceeding without background.");
  }

  ensureDirSync(workingDir);
  ensureDirSync(finalDir);

  const ai = new GoogleGenAI({});

  const outputs = [];
  let index = 0;
  let processed = 0;
  for await (const item of readJsonl(jsonlPath)) {
    index += 1;
    const brand = item.brand || "brand";
    const name = item.name || `item_${index}`;
    const imageUrl = item.imageUrl;
    if (!imageUrl) {
      console.warn(`Skipping item without imageUrl: ${brand} ${name}`);
      continue;
    }

    const baseName = toSafeFilename(`${brand}_${name}`);
    const workingFile = path.join(workingDir, `${baseName}.jpg`);
    const finalFile = path.join(finalDir, `${baseName}.jpg`);

    try {
      console.log(`Began working on: ${baseName}.jpg`);
      await downloadFile(imageUrl, workingFile);
      const inputBuffer = fs.readFileSync(workingFile);
      const enhancedBuffer = await enhanceImageWithGemini(ai, inputBuffer, backgroundBase64);
      fs.writeFileSync(finalFile, enhancedBuffer);

      outputs.push({
        ...item,
        localUpdatedFile: finalFile,
      });
      console.log(`Completed work: ${baseName}.jpg`);
      processed += 1;
      if (limit && processed >= limit) break;
    } catch (err) {
      console.error(`Failed: ${brand} - ${name}:`, err.message);
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


