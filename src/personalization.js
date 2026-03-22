const DEFAULT_PERSONALIZATION_SETTINGS = Object.freeze({
  tone: "balanced",
  characteristics: ["clear", "helpful", "evidence-grounded"],
  responseStyle: "concise",
});

const ALLOWED_TONES = new Set(["balanced", "warm", "professional", "direct"]);
const ALLOWED_RESPONSE_STYLES = new Set(["concise", "detailed"]);

function normalizeCharacteristics(input) {
  if (!Array.isArray(input)) {
    return DEFAULT_PERSONALIZATION_SETTINGS.characteristics;
  }

  const cleaned = input
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  if (cleaned.length === 0) {
    return DEFAULT_PERSONALIZATION_SETTINGS.characteristics;
  }

  return [...new Set(cleaned)].slice(0, 8);
}

export function getDefaultPersonalizationSettings() {
  return {
    tone: DEFAULT_PERSONALIZATION_SETTINGS.tone,
    characteristics: [...DEFAULT_PERSONALIZATION_SETTINGS.characteristics],
    responseStyle: DEFAULT_PERSONALIZATION_SETTINGS.responseStyle,
  };
}

export function normalizePersonalizationSettings(rawSettings) {
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const rawTone = String(source.tone || "").trim().toLowerCase();
  const rawResponseStyle = String(source.responseStyle || "").trim().toLowerCase();

  return {
    tone: ALLOWED_TONES.has(rawTone) ? rawTone : DEFAULT_PERSONALIZATION_SETTINGS.tone,
    characteristics: normalizeCharacteristics(source.characteristics),
    responseStyle: ALLOWED_RESPONSE_STYLES.has(rawResponseStyle)
      ? rawResponseStyle
      : DEFAULT_PERSONALIZATION_SETTINGS.responseStyle,
  };
}

export function buildPersonalizationSystemLayer({ sessionId, personalizationSettings }) {
  const settings = normalizePersonalizationSettings(personalizationSettings);
  const characteristicsText = settings.characteristics.join(", ");

  return [
    "system",
    [
      "[SYSTEM LAYER: PERSONALIZATION - SESSION_SCOPED]",
      `Session id: ${sessionId || "unknown-session"}`,
      "Treat this session as the active personalization profile.",
      `Tone: ${settings.tone}`,
      `Characteristics: ${characteristicsText}`,
      `Response style: ${settings.responseStyle}`,
      "Apply these preferences while still strictly following guardrails and retrieved evidence.",
    ].join("\n\n"),
  ];
}
