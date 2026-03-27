import crypto from "crypto";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  INDEX_SCHEMA_VERSION,
  PDF_MIN_EXTRACTED_CHARS,
} from "../config/index.js";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a"]);

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

  if (blocks.length === 0) {
    const fallbackText = normalizeInlineText(root.text());
    if (fallbackText) {
      return fallbackText;
    }
  }

  return deduplicateConsecutiveBlocks(blocks).join("\n\n");
}

function extractTextFromXhtml(xhtml) {
  if (!xhtml || xhtml.trim() === "") {
    return "";
  }

  const $ = cheerio.load(xhtml, { xmlMode: true, decodeEntities: true });

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

  const root = $("body").first().length > 0 ? $("body").first() : $.root();
  const blocks = [];
  const selectors = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "pre", "table"].join(", ");

  root.find(selectors).each((_, element) => {
    const $el = $(element);
    const tagName = (element.tagName || "").toLowerCase();
    if (!tagName) {
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
      blocks.push(`${"#".repeat(Number(tagName[1]))} ${text}`);
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

  if (blocks.length > 0) {
    return deduplicateConsecutiveBlocks(blocks).join("\n\n");
  }

  const fallbackText = normalizeInlineText(root.text());
  if (fallbackText) {
    return fallbackText;
  }

  return normalizeInlineText($.root().text());
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function extractTextFromCsv(csvContent) {
  if (!csvContent || csvContent.trim() === "") {
    return "";
  }

  const lines = csvContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  const rows = lines.map(parseCsvLine).map((row) => row.map((cell) => normalizeInlineText(cell)));
  const header = rows[0];

  if (header.length === 0) {
    return "";
  }

  const markdownLines = [];
  markdownLines.push(`| ${header.join(" | ")} |`);
  markdownLines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell) => !cell)) {
      continue;
    }

    const padded = [...row];
    while (padded.length < header.length) {
      padded.push("");
    }

    markdownLines.push(`| ${padded.slice(0, header.length).join(" | ")} |`);
  }

  return markdownLines.join("\n");
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

function decodeZipEntry(entry) {
  const data = entry.getData();
  if (!data || data.length === 0) {
    return "";
  }

  return data.toString("utf8").replace(/^\uFEFF/, "");
}

function normalizeZipPath(filePath) {
  if (!filePath) {
    return "";
  }

  return path.posix
    .normalize(String(filePath).replace(/\\/g, "/"))
    .replace(/^\/+/, "");
}

function getZipEntry(entryMap, requestedPath) {
  const normalizedPath = normalizeZipPath(requestedPath);
  if (!normalizedPath) {
    return null;
  }

  const candidates = [normalizedPath];

  try {
    const decoded = decodeURIComponent(normalizedPath);
    if (!candidates.includes(decoded)) {
      candidates.push(decoded);
    }
  } catch {
    // Ignore malformed URI sequences and keep best-effort lookup.
  }

  for (const candidate of candidates) {
    const entry = entryMap.get(candidate);
    if (entry) {
      return entry;
    }
  }

  return null;
}

function removeRepeatedBookChrome(sections) {
  if (!Array.isArray(sections) || sections.length < 2) {
    return sections;
  }

  const lineFrequency = new Map();
  sections.forEach((section) => {
    const uniqueLines = new Set(
      section
        .split("\n")
        .map((line) => normalizeInlineText(line).toLowerCase())
        .filter((line) => line.length >= 2 && line.length <= 120)
    );

    for (const line of uniqueLines) {
      lineFrequency.set(line, (lineFrequency.get(line) || 0) + 1);
    }
  });

  const repeatedLines = new Set(
    Array.from(lineFrequency.entries())
      .filter(([, frequency]) => frequency >= 3 && frequency >= Math.ceil(sections.length * 0.2))
      .map(([line]) => line)
  );

  if (repeatedLines.size === 0) {
    return sections;
  }

  const cleanedSections = sections
    .map((section, sectionIndex) =>
      section
        .split("\n")
        .filter((line) => !repeatedLines.has(normalizeInlineText(line).toLowerCase()))
        .join("\n")
        .trim()
    )
    .filter(Boolean);

  if (cleanedSections.length === 0) {
    return sections.filter((section) => normalizeInlineText(section).length > 0);
  }

  return cleanedSections;
}

function shouldSkipEpubFrontMatter(href, sectionText, sectionIndex) {
  const normalizedHref = href.toLowerCase();
  const frontMatterByPath = [
    "cover",
    "titlepage",
    "copyright",
    "toc",
    "contents",
    "frontmatter",
    "halftitle",
  ];

  if (frontMatterByPath.some((keyword) => normalizedHref.includes(keyword))) {
    return true;
  }

  if (sectionIndex > 1) {
    return false;
  }

  const normalizedText = normalizeInlineText(sectionText).toLowerCase();
  const frontMatterByText = [
    "table of contents",
    "all rights reserved",
    "copyright",
    "isbn",
  ];

  return frontMatterByText.some((token) => normalizedText.includes(token));
}

async function extractTextFromEpub(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const entryMap = new Map(entries.map((entry) => [normalizeZipPath(entry.entryName), entry]));

  const containerEntry = getZipEntry(entryMap, "META-INF/container.xml");
  if (!containerEntry) {
    console.warn(`[EPUB] Missing META-INF/container.xml in ${filePath}`);
    return "";
  }

  const containerXml = decodeZipEntry(containerEntry);
  const containerDoc = cheerio.load(containerXml, { xmlMode: true });
  const rootFilePath = containerDoc("rootfile").first().attr("full-path");
  if (!rootFilePath) {
    console.warn(`[EPUB] No rootfile path in container.xml for ${filePath}`);
    return "";
  }

  const packageEntry = getZipEntry(entryMap, rootFilePath);
  if (!rootFilePath || !packageEntry) {
    console.warn(`[EPUB] Package file not found (${rootFilePath || "unknown"}) in ${filePath}`);
    return "";
  }

  const packagePath = normalizeZipPath(rootFilePath);
  const packageDir = path.posix.dirname(packagePath);
  const packageXml = decodeZipEntry(packageEntry);
  const packageDoc = cheerio.load(packageXml, { xmlMode: true });

  const manifestById = new Map();
  packageDoc("manifest > item").each((_, item) => {
    const id = packageDoc(item).attr("id");
    const href = packageDoc(item).attr("href");
    const mediaType = String(packageDoc(item).attr("media-type") || "").trim().toLowerCase();
    const properties = String(packageDoc(item).attr("properties") || "").trim().toLowerCase();

    if (id && href && mediaType) {
      manifestById.set(id, {
        href,
        mediaType,
        properties,
      });
    }
  });

  const spineEntries = [];
  packageDoc("spine > itemref").each((_, itemref) => {
    const idref = packageDoc(itemref).attr("idref");
    const manifestItem = idref ? manifestById.get(idref) : null;
    if (!manifestItem) {
      return;
    }

    if (!["application/xhtml+xml", "text/html"].includes(manifestItem.mediaType)) {
      return;
    }

    if (manifestItem.properties.includes("nav")) {
      return;
    }

    spineEntries.push(manifestItem);
  });
  if (spineEntries.length === 0) {
    console.warn(`[EPUB] No usable spine entries in ${filePath}`);
  }

  const sections = [];

  for (let index = 0; index < spineEntries.length; index++) {
    const manifestItem = spineEntries[index];
    const chapterPath = normalizeZipPath(path.posix.join(packageDir, manifestItem.href));
    const chapterEntry = getZipEntry(entryMap, chapterPath);
    if (!chapterEntry) {
      continue;
    }

    const rawChapter = decodeZipEntry(chapterEntry);
    let chapterText = extractTextFromXhtml(rawChapter);
    if (!chapterText) {
      const $fallback = cheerio.load(rawChapter, { xmlMode: true, decodeEntities: true });
      chapterText = normalizeInlineText($fallback("body").text() || $fallback.root().text());
    }
    if (!chapterText) {
      console.warn(`[EPUB] Empty extracted text for chapter ${chapterPath} in ${filePath}`);
      continue;
    }

    if (shouldSkipEpubFrontMatter(chapterPath, chapterText, index)) {
      continue;
    }

    sections.push(chapterText);
  }

  if (sections.length === 0) {
    const fallbackEntries = entries
      .map((entry) => entry.entryName)
      .filter((name) => /\.(xhtml|html|htm)$/i.test(name))
      .sort();

    for (const entryName of fallbackEntries) {
      const fallbackEntry = getZipEntry(entryMap, entryName);
      if (!fallbackEntry) {
        continue;
      }

      const rawFallbackChapter = decodeZipEntry(fallbackEntry);
      let fallbackText = extractTextFromXhtml(rawFallbackChapter);
      if (!fallbackText) {
        const $fallback = cheerio.load(rawFallbackChapter, { xmlMode: true, decodeEntities: true });
        fallbackText = normalizeInlineText($fallback("body").text() || $fallback.root().text());
      }
      if (!fallbackText || shouldSkipEpubFrontMatter(entryName, fallbackText, 99)) {
        continue;
      }

      sections.push(fallbackText);
    }
  }

  return removeRepeatedBookChrome(sections).join("\n\n").trim();
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

export function extractIndexableTextByExtension(rawContent, extension) {
  if (!rawContent) {
    return "";
  }

  if (extension === ".html" || extension === ".htm") {
    return extractTextFromHtml(rawContent);
  }
  if (extension === ".csv") {
    return extractTextFromCsv(rawContent);
  }

  return rawContent;
}

export function normalizeIndexableTextByExtension(rawContent, extension) {
  return normalizeTextForIndexing(extractIndexableTextByExtension(rawContent, extension));
}

export async function normalizeIndexableFileByExtension(filePath, extension, encoding = "utf8", options = {}) {
  const normalizedExtension = extension.toLowerCase();

  if (normalizedExtension === ".pdf") {
    if (typeof options.pdfOcrHandler === "function" && options.pdfExtractionMode === "ocr_only") {
      const ocrText = await options.pdfOcrHandler({
        filePath,
        extractedText: "",
        minimumExtractedChars: Number.parseInt(
          options.minimumExtractedChars ?? PDF_MIN_EXTRACTED_CHARS,
          10
        ),
        relativePath: options.relativePath,
      });
      return normalizeTextForIndexing(typeof ocrText === "string" ? ocrText : "");
    }

    const extractedText = normalizeTextForIndexing(await extractTextFromPdf(filePath));
    const minimumExtractedChars = Number.parseInt(
      options.minimumExtractedChars ?? PDF_MIN_EXTRACTED_CHARS,
      10
    );

    if (
      typeof options.pdfOcrHandler === "function" &&
      extractedText.length < minimumExtractedChars
    ) {
      const ocrText = await options.pdfOcrHandler({
        filePath,
        extractedText,
        minimumExtractedChars,
        relativePath: options.relativePath,
      });
      if (typeof ocrText === "string" && ocrText.trim().length > 0) {
        return normalizeTextForIndexing(ocrText);
      }
    }

    return extractedText;
  }
  if (normalizedExtension === ".epub") {
    return normalizeTextForIndexing(await extractTextFromEpub(filePath));
  }
  if (AUDIO_EXTENSIONS.has(normalizedExtension)) {
    if (typeof options.audioTranscriptionHandler === "function") {
      const transcribedText = await options.audioTranscriptionHandler({
        filePath,
        extension: normalizedExtension,
        relativePath: options.relativePath,
      });
      return normalizeTextForIndexing(typeof transcribedText === "string" ? transcribedText : "");
    }
    return "";
  }

  const rawContent = fs.readFileSync(filePath, encoding);
  return normalizeIndexableTextByExtension(rawContent, normalizedExtension);
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

export async function readTextFilesRecursively(
  dirPath,
  allowedExtensions,
  encoding = "utf8",
  options = {}
) {
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
        const relativePath = path.relative(dirPath, itemPath);
        const content = await normalizeIndexableFileByExtension(itemPath, ext, encoding, {
          ...options,
          relativePath,
        });

        if (!content || content.length === 0) {
          console.log(`Skipping file with no indexable text: ${itemPath}`);
          continue;
        }

        files.push({
          path: itemPath,
          relativePath,
          filename: path.basename(itemPath),
          extension: ext,
          content,
          hash: buildIndexRelevantHash(content),
          size: stats.size,
          lastModified: stats.mtimeMs,
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
