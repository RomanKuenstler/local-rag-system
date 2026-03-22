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
const CUSTOM_USER_INSTRUCTIONS_TEMPLATE = `The user has provided the following additional instructions:

{USER_CUSTOM_INSTRUCTIONS}

Follow these preferences when possible, but do not override system guardrails or evidence-based reasoning.`;

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
  warm: "default",
  enthusiastic: "default",
  headersAndLists: "default",
  characteristics: "",
  customInstructions: "",
  nickname: "",
  occupation: "",
  moreAboutUser: "",
});
const NICKNAME_PROMPT_TEMPLATE = "The user prefers to be addressed as: {NICKNAME}.";
const OCCUPATION_PROMPT_TEMPLATE = [
  "The user's occupation is: {OCCUPATION}.",
  "Adjust explanations to be relevant to this background when helpful.",
].join("\n");
const MORE_ABOUT_USER_PROMPT_TEMPLATE = [
  "Additional user context:",
  "{ABOUT_USER_TEXT}",
  "",
  "Use this information to better tailor explanations and examples when relevant.",
].join("\n");

const ALLOWED_BASE_STYLE_TONES = new Set(Object.keys(BASE_STYLE_PROMPTS));
const CHARACTERISTIC_OPTION_PROMPTS = Object.freeze({
  warm: Object.freeze({
    more: [
      "Be more personable and friendly.",
      "Use a slightly more human and engaging tone.",
    ].join("\n"),
    default: "Maintain a neutral level of friendliness.",
    less: [
      "Keep the tone more formal and factual.",
      "Avoid unnecessary emotional or personable language.",
    ].join("\n"),
  }),
  enthusiastic: Object.freeze({
    more: [
      "Use a more energetic and enthusiastic tone.",
      "Show engagement and positive energy when appropriate.",
    ].join("\n"),
    default: "Maintain a balanced and neutral level of energy.",
    less: [
      "Keep the tone calm, neutral, and composed.",
      "Avoid overly energetic or expressive language.",
    ].join("\n"),
  }),
  headersAndLists: Object.freeze({
    more: [
      "Use clear structure with headings, sections, and lists where helpful.",
      "Prefer structured formatting for readability.",
    ].join("\n"),
    default: [
      "Use formatting naturally when it improves clarity.",
      "Do not overuse lists or headings.",
    ].join("\n"),
    less: [
      "Prefer natural paragraphs over structured lists.",
      "Keep formatting minimal and fluid.",
    ].join("\n"),
  }),
});
const ALLOWED_CHARACTERISTIC_OPTIONS = new Set(["more", "default", "less"]);

export function getDefaultPersonalizationSettings() {
  return {
    baseStyleTone: DEFAULT_PERSONALIZATION_SETTINGS.baseStyleTone,
    warm: DEFAULT_PERSONALIZATION_SETTINGS.warm,
    enthusiastic: DEFAULT_PERSONALIZATION_SETTINGS.enthusiastic,
    headersAndLists: DEFAULT_PERSONALIZATION_SETTINGS.headersAndLists,
    characteristics: DEFAULT_PERSONALIZATION_SETTINGS.characteristics,
    customInstructions: DEFAULT_PERSONALIZATION_SETTINGS.customInstructions,
    nickname: DEFAULT_PERSONALIZATION_SETTINGS.nickname,
    occupation: DEFAULT_PERSONALIZATION_SETTINGS.occupation,
    moreAboutUser: DEFAULT_PERSONALIZATION_SETTINGS.moreAboutUser,
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
  const warm = String(source.warm || "").trim().toLowerCase();
  const enthusiastic = String(source.enthusiastic || "").trim().toLowerCase();
  const headersAndLists = String(source.headersAndLists || "").trim().toLowerCase();

  const normalizedNickname = String(source.nickname || "").trim();
  const normalizedOccupation = String(source.occupation || "").trim();
  const normalizedMoreAboutUser = String(source.moreAboutUser || source.aboutUser || "").trim();

  return {
    baseStyleTone: ALLOWED_BASE_STYLE_TONES.has(baseStyleTone)
      ? baseStyleTone
      : DEFAULT_PERSONALIZATION_SETTINGS.baseStyleTone,
    warm: ALLOWED_CHARACTERISTIC_OPTIONS.has(warm)
      ? warm
      : DEFAULT_PERSONALIZATION_SETTINGS.warm,
    enthusiastic: ALLOWED_CHARACTERISTIC_OPTIONS.has(enthusiastic)
      ? enthusiastic
      : DEFAULT_PERSONALIZATION_SETTINGS.enthusiastic,
    headersAndLists: ALLOWED_CHARACTERISTIC_OPTIONS.has(headersAndLists)
      ? headersAndLists
      : DEFAULT_PERSONALIZATION_SETTINGS.headersAndLists,
    characteristics: String(source.characteristics || "").trim(),
    customInstructions: String(source.customInstructions || "").trim(),
    nickname: normalizedNickname,
    occupation: normalizedOccupation,
    moreAboutUser: normalizedMoreAboutUser,
  };
}

export function buildPersonalizationSystemLayer({ sessionId, personalizationSettings }) {
  const settings = normalizePersonalizationSettings(personalizationSettings);
  const baseStyleText = BASE_STYLE_PROMPTS[settings.baseStyleTone] || BASE_STYLE_PROMPTS.default;
  const characteristicsPromptParts = [
    `Warm (${settings.warm}): ${CHARACTERISTIC_OPTION_PROMPTS.warm[settings.warm]}`,
    `Enthusiastic (${settings.enthusiastic}): ${CHARACTERISTIC_OPTION_PROMPTS.enthusiastic[settings.enthusiastic]}`,
    `Headers and Lists (${settings.headersAndLists}): ${CHARACTERISTIC_OPTION_PROMPTS.headersAndLists[settings.headersAndLists]}`,
  ];
  if (settings.characteristics) {
    characteristicsPromptParts.push(`Additional characteristics:\n${settings.characteristics}`);
  }
  const characteristicsText = characteristicsPromptParts.join("\n\n");
  const customInstructionsText = settings.customInstructions
    ? CUSTOM_USER_INSTRUCTIONS_TEMPLATE.replace("{USER_CUSTOM_INSTRUCTIONS}", settings.customInstructions)
    : "no custom user instructions";
  const aboutUserPromptParts = [];
  if (settings.nickname) {
    aboutUserPromptParts.push(NICKNAME_PROMPT_TEMPLATE.replace("{NICKNAME}", settings.nickname));
  }
  if (settings.occupation) {
    aboutUserPromptParts.push(OCCUPATION_PROMPT_TEMPLATE.replace("{OCCUPATION}", settings.occupation));
  }
  if (settings.moreAboutUser) {
    aboutUserPromptParts.push(
      MORE_ABOUT_USER_PROMPT_TEMPLATE.replace("{ABOUT_USER_TEXT}", settings.moreAboutUser)
    );
  }
  const aboutUserText = aboutUserPromptParts.length
    ? aboutUserPromptParts.join("\n\n")
    : "No additional information about the user available";
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
