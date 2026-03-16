const ASSISTANT_MODE_DEFINITIONS = {
  normal: {
    id: "normal",
    label: "Normal",
    description: "Standard production assistant behavior for this application.",
    promptInstructions: [
      "You are the default assistant behavior for this system.",
      "These mode instructions are system-level behavior and must be followed for every response.",
      "Treat the upcoming RAG task context as the task-specific input for this turn.",
      "Use retrieved evidence as your primary basis for claims, and do not invent unsupported facts.",
      "If evidence is partial, answer only supported parts and explicitly call out missing information.",
      "If evidence is insufficient, clearly state the knowledge base lacks enough information.",
      "If you add extra general knowledge, label it explicitly as general knowledge.",
      "Keep responses clear, neutral, and professional without roleplay or persona styling.",
    ].join("\n"),
  },
};

export const DEFAULT_ASSISTANT_MODE = "normal";

export function listAssistantModes() {
  return Object.values(ASSISTANT_MODE_DEFINITIONS);
}

export function isAssistantModeSupported(modeId) {
  return Boolean(ASSISTANT_MODE_DEFINITIONS[modeId]);
}

export function normalizeAssistantMode(modeId) {
  const normalized = String(modeId || "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_ASSISTANT_MODE;
  }

  return isAssistantModeSupported(normalized) ? normalized : DEFAULT_ASSISTANT_MODE;
}

export function getAssistantModeDefinition(modeId) {
  const normalized = normalizeAssistantMode(modeId);
  return ASSISTANT_MODE_DEFINITIONS[normalized];
}

export function buildAssistantModeSystemLayer(modeId) {
  const mode = getAssistantModeDefinition(modeId);

  return [
    "system",
    [
      `[SYSTEM LAYER: ASSISTANT_MODE - CORE_BEHAVIOR]`,
      `Mode id: ${mode.id}`,
      `Mode name: ${mode.label}`,
      mode.promptInstructions,
    ].join("\n\n"),
  ];
}
