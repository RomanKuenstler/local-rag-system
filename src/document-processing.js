import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  INDEX_SCHEMA_VERSION,
  PDF_MIN_EXTRACTED_CHARS,
} from "./config.js";

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function normalizeTextForIndexing(text) {
  if (!text) {
    return "";
  }

  text = text.normalize("NFKC");

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePreformattedText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function deduplicateConsecutiveBlocks(blocks) {
  const cleaned = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== trimmed) {
      cleaned.push(trimmed);
    }
  }

  return cleaned;
}

function extractTextFromHtml(html) {
  if (!html || html.trim() === "") {
    return "";
  }

  const $ = cheerio.load(html);

  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "canvas",
      "iframe",
      "nav",
      "footer",
      "aside",
      "form",
      "button",
      "input",
      "select",
      "textarea",
      "img",
      "picture",
      "video",
      "audio",
      "source",
      "meta",
      "link",
      "object",
      "embed",
      "advertisement",
    ].join(", ")
  ).remove();

  const root =
    $("main").first().length > 0
      ? $("main").first()
      : $("article").first().length > 0
        ? $("article").first()
        : $('[role="main"]').first().length > 0
          ? $('[role="main"]').first()
          : $("body").first().length > 0
            ? $("body").first()
            : $.root();

  const blocks = [];
  const selectors = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "pre", "table"].join(", ");

  root.find(selectors).each((_, element) => {
    const $el = $(element);
    const tagName = (element.tagName || "").toLowerCase();

    if (!tagName) {
      return;
    }

    if ($el.closest("nav, footer, aside, form, script, style, noscript").length > 0) {
      return;
    }

    let text = "";

    if (tagName === "table") {
      const rows = [];

      $el.find("tr").each((_, row) => {
        const cells = [];
        $(row)
          .find("th, td")
          .each((_, cell) => {
            const cellText = normalizeInlineText($(cell).text());
            if (cellText) {
              cells.push(cellText);
            }
          });

        if (cells.length > 0) {
          rows.push(cells.join(" | "));
        }
      });

      if (rows.length > 0) {
        text = rows.join("\n");
      }
    } else if (tagName === "pre") {
      text = normalizePreformattedText($el.text());
      if (text) {
        text = `\`\`\`\n${text}\n\`\`\``;
      }
    } else {
      text = normalizeInlineText($el.text());
    }

    if (!text) {
      return;
    }

    if (/^h[1-6]$/.test(tagName)) {
      const level = Number(tagName[1]);
      blocks.push(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (tagName === "li") {
      blocks.push(`- ${text}`);
      return;
    }

    if (tagName === "blockquote") {
      blocks.push(`> ${text}`);
      return;
    }

    blocks.push(text);
  });

  return deduplicateConsecutiveBlocks(blocks).join("\n\n");
}

function normalizePdfPageText(text) {
  if (!text) {
    return "";
  }

  let cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  cleaned = cleaned
    .split("\n")
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .join("\n")
    .trim();

  return cleaned;
}

async function extractTextFromPdf(filePath) {
  const loadingTask = pdfjsLib.getDocument(filePath);
  const pdf = await loadingTask.promise;
  const pageSections = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const rawItems = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .map((text) => text.trim())
      .filter(Boolean);

    if (rawItems.length === 0) {
      continue;
    }

    const pageText = normalizePdfPageText(rawItems.join("\n"));

    if (!pageText || pageText.length < PDF_MIN_EXTRACTED_CHARS) {
      continue;
    }

    pageSections.push(`## PDF Page ${pageNumber}\n\n${pageText}`);
  }

  return pageSections.join("\n\n").trim();
}

function extractIndexableTextByExtension(rawContent, extension) {
  if (!rawContent) {
    return "";
  }

  if (extension === ".html" || extension === ".htm") {
    return extractTextFromHtml(rawContent);
  }

  return rawContent;
}

function buildIndexRelevantHash(content) {
  const normalizedContent = normalizeTextForIndexing(content);

  return sha256(
    JSON.stringify({
      normalizedContent,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
      indexSchemaVersion: INDEX_SCHEMA_VERSION,
    })
  );
}

export async function readTextFilesRecursively(dirPath, allowedExtensions, encoding = "utf8") {
  dirPath = path.resolve(dirPath);

  if (!Array.isArray(allowedExtensions)) {
    allowedExtensions = [allowedExtensions];
  }

  allowedExtensions = allowedExtensions.map((ext) =>
    ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  );

  const files = [];

  async function scanDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        await scanDirectory(itemPath);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      const ext = path.extname(item).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        continue;
      }

      try {
        let extractedContent = "";

        if (ext === ".pdf") {
          extractedContent = await extractTextFromPdf(itemPath);
        } else {
          const rawContent = fs.readFileSync(itemPath, encoding);
          extractedContent = extractIndexableTextByExtension(rawContent, ext);
        }

        const content = normalizeTextForIndexing(extractedContent);

        if (!content || content.length === 0) {
          console.log(`Skipping file with no indexable text: ${itemPath}`);
          continue;
        }

        files.push({
          path: itemPath,
          relativePath: path.relative(dirPath, itemPath),
          filename: path.basename(itemPath),
          extension: ext,
          content,
          hash: buildIndexRelevantHash(extractedContent),
        });
      } catch (error) {
        console.error(`Error reading file ${itemPath}: ${error.message}`);
      }
    }
  }

  try {
    await scanDirectory(dirPath);
  } catch (error) {
    console.error(`Error accessing directory ${dirPath}: ${error.message}`);
  }

  return files;
}
