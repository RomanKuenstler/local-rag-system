import { randomUUID } from "crypto";
import { CHUNK_OVERLAP, CHUNK_SIZE, MAX_EMBEDDING_CHARS } from "./config.js";

export function splitMarkdownBySectionsWithMetadata(markdown) {
  if (!markdown || markdown === "") {
    return [];
  }

  const headerRegex = /^\s*(#+)\s+(.*)$/gm;
  const headerMatches = [];
  let match;

  while ((match = headerRegex.exec(markdown)) !== null) {
    headerMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      title: match[2].trim(),
    });
  }

  if (headerMatches.length === 0) {
    const trimmed = markdown.trim();
    return trimmed ? [{ title: "Document", content: trimmed }] : [];
  }

  const sections = [];

  if (headerMatches[0].start > 0) {
    const preHeader = markdown.substring(0, headerMatches[0].start).trim();
    if (preHeader !== "") {
      sections.push({ title: "Introduction", content: preHeader });
    }
  }

  for (let i = 0; i < headerMatches.length; i++) {
    const start = headerMatches[i].start;
    const end = i < headerMatches.length - 1 ? headerMatches[i + 1].start : markdown.length;
    const section = markdown.substring(start, end).trim();
    if (section !== "") {
      sections.push({
        title: headerMatches[i].title || "Section",
        content: section,
      });
    }
  }

  return sections;
}

export function splitTextIntoOverlappingChunks(text, chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP) {
  if (!text || text.trim() === "") {
    return [];
  }

  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalizedText
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return splitLongTextWithOverlap(normalizedText, chunkSize, chunkOverlap);
  }

  const chunks = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;

    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    if (paragraph.length > chunkSize) {
      const splitParagraphChunks = splitLongTextWithOverlap(paragraph, chunkSize, chunkOverlap);
      for (let i = 0; i < splitParagraphChunks.length - 1; i++) {
        chunks.push(splitParagraphChunks[i]);
      }
      currentChunk = splitParagraphChunks[splitParagraphChunks.length - 1] || "";
    } else {
      currentChunk = paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return addOverlapToChunks(chunks, chunkOverlap);
}

export function splitLongTextWithOverlap(text, chunkSize, chunkOverlap) {
  const chunks = [];
  const normalized = text.trim();

  if (!normalized) {
    return chunks;
  }

  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const boundaryCandidates = [
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf(" "),
      ];

      const bestBoundary = Math.max(...boundaryCandidates);
      if (bestBoundary > Math.floor(chunkSize * 0.6)) {
        end = start + bestBoundary + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - chunkOverlap, start + 1);
  }

  return chunks;
}

export function addOverlapToChunks(chunks, chunkOverlap) {
  if (!chunks || chunks.length <= 1 || chunkOverlap <= 0) {
    return chunks;
  }

  const overlappedChunks = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const previousChunk = chunks[i - 1];
    const currentChunk = chunks[i];
    const overlapText = previousChunk.slice(-chunkOverlap).trim();
    const mergedChunk = overlapText ? `${overlapText}\n\n${currentChunk}` : currentChunk;
    overlappedChunks.push(mergedChunk);
  }

  return overlappedChunks;
}

export function enforceEmbeddingSizeLimit(chunks, maxChars = MAX_EMBEDDING_CHARS) {
  const safeChunks = [];

  for (const chunk of chunks) {
    const splitChunks = splitChunkRecursivelyToSafeSize(chunk, maxChars);
    safeChunks.push(...splitChunks);
  }

  return safeChunks;
}

function splitChunkRecursivelyToSafeSize(chunk, maxChars) {
  if (!chunk.text || chunk.text.length <= maxChars) {
    return [chunk];
  }

  const overlap = Math.min(CHUNK_OVERLAP, Math.floor(maxChars / 6));
  const splitTexts = splitLongTextWithOverlap(chunk.text, maxChars, overlap);

  if (splitTexts.length <= 1 && chunk.text.length > maxChars) {
    const hardSplitTexts = hardSplitText(chunk.text, maxChars, overlap);

    return hardSplitTexts.flatMap((text, index) =>
      splitChunkRecursivelyToSafeSize(
        {
          ...chunk,
          id: randomUUID(),
          text,
          subchunkIndex: formatSubchunkIndex(chunk.subchunkIndex, index),
        },
        maxChars
      )
    );
  }

  return splitTexts.flatMap((text, index) =>
    splitChunkRecursivelyToSafeSize(
      {
        ...chunk,
        id: randomUUID(),
        text: text.trim(),
        subchunkIndex: formatSubchunkIndex(chunk.subchunkIndex, index),
      },
      maxChars
    )
  );
}

function hardSplitText(text, maxChars, overlap) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const piece = text.slice(start, end).trim();

    if (piece) {
      chunks.push(piece);
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function formatSubchunkIndex(baseIndex, index) {
  if (baseIndex === undefined || baseIndex === null) {
    return `${index}`;
  }

  return `${baseIndex}.${index}`;
}
