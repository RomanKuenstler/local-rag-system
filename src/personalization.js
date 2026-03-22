const PERSONALIZATION_TEMPLATE = `# Personalization

The following preferences describe how the assistant should communicate and adapt to the user.

These are stylistic and behavioral preferences. They must not override system guardrails or evidence-based reasoning.

## Base Style and Tone
{BASE_STYLE}

## Communication Characteristics
{CHARACTERISTICS}

## Custom Instructions
{CUSTOM_INSTRUCTIONS}

## About the User
{ABOUT_USER}`;

const BASE_STYLE_PROMPTS = Object.freeze({
  default: [
    "Use a balanced, neutral, and clear tone.",
    "Be helpful and direct without strong stylistic bias.",
  ].join("\n"),
  professional: [
    "Use a polished, precise, and professional tone.",
    "Be structured, formal, and concise.",
    "Avoid unnecessary informality or casual language.",
  ].join("\n"),
  friendly: [
    "Use a warm, friendly, and approachable tone.",
    "Be conversational and easy to understand.",
    "Make the interaction feel natural and engaging.",
  ].join("\n"),
  direct: [
    "Use a direct and honest tone.",
    "Be clear and straightforward, without unnecessary softening.",
    "Encourage clarity and practical understanding.",
    "Remain respectful and helpful at all times.",
  ].join("\n"),
  quirky: [
    "Use a playful, creative, and slightly imaginative tone.",
    "Allow light humor or creative phrasing where appropriate.",
    "Do not sacrifice clarity or correctness for style.",
  ].join("\n"),
  efficient: [
    "Use a concise and minimal style.",
    "Focus on delivering information clearly and directly.",
    "Avoid unnecessary elaboration or filler content.",
  ].join("\n"),
  sceptical: [
    "Use a skeptical and critical tone when appropriate.",
    "Question assumptions and avoid taking statements at face value.",
    "Highlight uncertainties and potential flaws in reasoning.",
    "Remain respectful, constructive, and helpful.",
  ].join("\n"),
});

const DEFAULT_PERSONALIZATION_SETTINGS = Object.freeze({
  baseStyleTone: "default",
  characteristics: "",
  customInstructions: "",
  aboutUser: "",
});

const ALLOWED_BASE_STYLE_TONES = new Set(Object.keys(BASE_STYLE_PROMPTS));

export function getDefaultPersonalizationSettings() {
  return {
    baseStyleTone: DEFAULT_PERSONALIZATION_SETTINGS.baseStyleTone,
    characteristics: DEFAULT_PERSONALIZATION_SETTINGS.characteristics,
    customInstructions: DEFAULT_PERSONALIZATION_SETTINGS.customInstructions,
    aboutUser: DEFAULT_PERSONALIZATION_SETTINGS.aboutUser,
  };
}

export function normalizePersonalizationSettings(rawSettings) {
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const legacyTone = String(source.tone || "").trim().toLowerCase();
  const rawBaseStyleTone = String(source.baseStyleTone || "").trim().toLowerCase();
  const normalizedBaseStyleTone = rawBaseStyleTone || ({
    balanced: "default",
    warm: "friendly",
    professional: "professional",
    direct: "direct",
  }[legacyTone] || "");
  const baseStyleTone = normalizedBaseStyleTone === "skeptical"
    ? "sceptical"
    : normalizedBaseStyleTone;

  return {
    baseStyleTone: ALLOWED_BASE_STYLE_TONES.has(baseStyleTone)
      ? baseStyleTone
      : DEFAULT_PERSONALIZATION_SETTINGS.baseStyleTone,
    characteristics: String(source.characteristics || "").trim(),
    customInstructions: String(source.customInstructions || "").trim(),
    aboutUser: String(source.aboutUser || "").trim(),
  };
}

export function buildPersonalizationSystemLayer({ sessionId, personalizationSettings }) {
  const settings = normalizePersonalizationSettings(personalizationSettings);
  const baseStyleText = BASE_STYLE_PROMPTS[settings.baseStyleTone] || BASE_STYLE_PROMPTS.default;
  const characteristicsText = settings.characteristics || "No communication characteristics configured yet.";
  const customInstructionsText = settings.customInstructions || "No custom instructions provided.";
  const aboutUserText = settings.aboutUser || "No user background details provided.";
  const personalizationPrompt = PERSONALIZATION_TEMPLATE
    .replace("{BASE_STYLE}", baseStyleText)
    .replace("{CHARACTERISTICS}", characteristicsText)
    .replace("{CUSTOM_INSTRUCTIONS}", customInstructionsText)
    .replace("{ABOUT_USER}", aboutUserText);

  return [
    "system",
    [
      "[SYSTEM LAYER: PERSONALIZATION - SESSION_SCOPED]",
      `Session id: ${sessionId || "unknown-session"}`,
      "Treat this session as the active personalization profile.",
      "Apply these preferences while still strictly following guardrails and retrieved evidence.",
      personalizationPrompt,
    ].join("\n\n"),
  ];
}
