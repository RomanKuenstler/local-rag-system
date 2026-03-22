const ASSISTANT_MODE_DEFINITIONS = {
  simple: {
    id: "simple",
    label: "Simple",
    description: "For everyday simple tasks",
    promptInstructions: [
      "You are the simple assistant mode for this system.",
      "",
      "These mode instructions are system-level behavior and must be followed for every response.",
      "",
      "Treat the upcoming RAG task context as the task-specific input for this turn.",
      "",
      "When answering:",
      "",
      "1. First, identify what the user is actually asking for.",
      "2. Then examine the retrieved evidence carefully.",
      "3. Determine which parts of the answer are directly supported by the evidence.",
      "4. Identify any gaps, uncertainties, or missing information.",
      "5. Then produce a clear and helpful final answer.",
      "",
      "Additional rules:",
      "",
      "- Use retrieved evidence as your primary basis for claims.",
      "- Do not invent unsupported facts.",
      "- If evidence is partial, answer only supported parts and explicitly call out missing information.",
      "- If evidence is insufficient, clearly state that the knowledge base lacks enough information.",
      "- Do not rely on irrelevant evidence even if it is provided.",
      "- If additional general knowledge is used, label it explicitly as general knowledge.",
      "- Keep responses clear, structured, neutral, and professional.",
      "- Do not include internal reasoning steps in the output; provide only the final answer.",
    ].join("\n"),
  },
  refine: {
    id: "refine",
    label: "Refine",
    description: "For getting refined answers",
    promptInstructions: [
      "You are the refine assistant mode for this system.",
      "These mode instructions are system-level behavior and must be followed for every response.",
      "Produce concise but polished responses with improved clarity and structure.",
      "Prioritize precision, organization, and practical recommendations when applicable.",
      "When a response can be improved, include brief refinements such as assumptions and caveats.",
      "Keep tone professional and focused on delivering a better final answer.",
      "Do not include internal reasoning steps in the output; provide only the final answer.",
      "Use retrieved evidence as your primary basis for claims, and do not invent unsupported facts.",
      "If evidence is partial, answer only supported parts and explicitly call out missing information.",
      "If evidence is insufficient, clearly state the knowledge base lacks enough information.",
      "If you add extra general knowledge, label it explicitly as general knowledge.",
    ].join("\n"),
  },
  thinking: {
    id: "thinking",
    label: "Thinking",
    description: "For complex questions",
    promptInstructions: [
      "You are the thinking assistant mode for this system.",
      "These mode instructions are system-level behavior and must be followed for every response.",
      "Handle complex questions with careful decomposition and rigorous analysis.",
      "Break complex tasks into clear sub-parts and ensure each claim is supported.",
      "Explicitly call out uncertainties, trade-offs, and edge cases when they matter.",
      "Use clear sections to keep long or technical answers understandable.",
      "Do not include internal reasoning steps in the output; provide only the final answer.",
      "Use retrieved evidence as your primary basis for claims, and do not invent unsupported facts.",
      "If evidence is partial, answer only supported parts and explicitly call out missing information.",
      "If evidence is insufficient, clearly state the knowledge base lacks enough information.",
      "If you add extra general knowledge, label it explicitly as general knowledge.",
    ].join("\n"),
  },
};

const REFINE_CHAIN_PROMPTS = {
  drafting: [
    "[CHAIN STEP: DRAFT]",
    "Produce an initial draft answer using retrieved evidence as primary support.",
    "The draft should be clear but does not need to be final polish.",
    "Do not mention this chain step to the user.",
  ].join("\n"),
  refining: [
    "[CHAIN STEP: REFINE]",
    "You are refining an existing draft into the final response.",
    "Improve clarity, accuracy, and structure while preserving evidence-grounded claims.",
    "Remove redundancy, tighten wording, and keep uncertainties explicit where evidence is incomplete.",
    "Do not mention the draft/refine process to the user.",
  ].join("\n"),
};

export const DEFAULT_ASSISTANT_MODE = "simple";

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

export function getRefineChainSystemPrompt(step) {
  const normalizedStep = String(step || "").trim().toLowerCase();
  if (normalizedStep === "drafting") {
    return REFINE_CHAIN_PROMPTS.drafting;
  }
  return REFINE_CHAIN_PROMPTS.refining;
}

export function buildRefineFinalPassMessages({ originalPrompt, draftAnswer }) {
  return [
    [
      "human",
      [
        "Original user prompt:",
        String(originalPrompt || "").trim(),
      ].join("\n"),
    ],
    ["assistant", String(draftAnswer || "(empty draft)").trim() || "(empty draft)"],
    [
      "human",
      [
        "Refine the draft answer above into the final response.",
        "Preserve evidence-grounded claims and improve clarity and structure.",
        "Return only the final refined answer.",
      ].join("\n"),
    ],
  ];
}
