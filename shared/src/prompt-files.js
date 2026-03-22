import fs from "fs";

export function loadPromptFile({ filePath, fallback, label }) {
  try {
    const loaded = String(fs.readFileSync(filePath, "utf8") || "").trim();
    return loaded || fallback;
  } catch (error) {
    console.warn(`${label} file not found at ${filePath}. Falling back to built-in prompt.`);
    return fallback;
  }
}
