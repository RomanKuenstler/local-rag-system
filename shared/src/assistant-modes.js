import { loadPromptFile } from "./prompt-files.js";

export const ASSISTANT_PROMPTS_DIR = "/app/prompts";
const ASSISTANT_MODE_SIMPLE_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-mode-simple.md`;
const ASSISTANT_MODE_THINKING_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-mode-thinking.md`;
const ASSISTANT_REFINE_DRAFT_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-refine-draft.md`;
const ASSISTANT_REFINE_REFINING_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-refine-refining.md`;

const SHARED_EVIDENCE_RULES = [
  "Use retrieved evidence as your primary basis for claims.",
  "Do not invent unsupported facts.",
  "If evidence is partial, answer only supported parts and explicitly call out missing information.",
  "If evidence is insufficient, clearly state that the knowledge base lacks enough information.",
  "If additional general knowledge is used, label it explicitly as general knowledge.",
];

const REFINE_DRAFT_PROMPT_DEFAULT = [
  "You are the draft-generation step for the assistant's thinking mode.",
  "",
  "Your job is to create a first draft answer to the user's question using the provided retrieved evidence, recent conversation history, and uploaded prompt files if any.",
  "",
  "Rules:",
  "",
  "1. Use retrieved evidence as the primary basis for the draft.",
  "2. Focus on correctness and relevance first.",
  "3. Answer the user's actual question directly.",
  "4. Use only evidence that is relevant to the question.",
  "5. If evidence is partial, answer only the supported parts and note what is missing.",
  "6. If evidence is insufficient, clearly say that the knowledge base does not contain enough information.",
  "7. Do not invent unsupported facts.",
  "8. If you use additional general knowledge, label it explicitly as general knowledge.",
  "9. Do not explain your internal reasoning process.",
  "10. Produce a usable draft answer, even if the structure is not perfect yet.",
  "",
  "Before drafting, do this internally:",
  "- identify what the user is asking for",
  "- review the retrieved evidence",
  "- determine what is supported, uncertain, or missing",
  "",
  "Output:",
  "- return only the draft answer text",
  "- do not return analysis, notes, or bullet lists about your internal process unless the answer itself requires them",
].join("\n");

const REFINE_DRAFT_PROMPT = loadPromptFile({
  filePath: ASSISTANT_REFINE_DRAFT_PATH,
  fallback: REFINE_DRAFT_PROMPT_DEFAULT,
  label: "Assistant refine draft prompt",
});

const ASSISTANT_MODE_DEFINITIONS = {
  simple: {
    id: "simple",
    label: "Simple",
    description: "For everyday simple tasks",
    promptInstructions: loadPromptFile({
      filePath: ASSISTANT_MODE_SIMPLE_PATH,
      fallback: [
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
      label: "Assistant simple mode prompt",
    }),
  },
  refine: {
    id: "refine",
    label: "Refine",
    description: "For getting refined answers",
    promptInstructions: [
      REFINE_DRAFT_PROMPT,
    ].join("\n"),
  },
  thinking: {
    id: "thinking",
    label: "Thinking",
    description: "For complex questions",
    promptInstructions: loadPromptFile({
      filePath: ASSISTANT_MODE_THINKING_PATH,
      fallback: [
        "You are the thinking assistant mode for this system.",
        "These mode instructions are system-level behavior and must be followed for every response.",
        "Handle complex questions with careful decomposition and rigorous analysis.",
        "Break complex tasks into clear sub-parts and ensure each claim is supported.",
        "Explicitly call out uncertainties, trade-offs, and edge cases when they matter.",
        "Use clear sections to keep long or technical answers understandable.",
        "Do not include internal reasoning steps in the output; provide only the final answer.",
        ...SHARED_EVIDENCE_RULES,
      ].join("\n"),
      label: "Assistant thinking mode prompt",
    }),
  },
};

const REFINE_CHAIN_PROMPTS = {
  drafting: [
    "[CHAIN STEP: DRAFT]",
    REFINE_DRAFT_PROMPT,
  ].join("\n"),
  refining: [
    "[CHAIN STEP: REFINE]",
    loadPromptFile({
      filePath: ASSISTANT_REFINE_REFINING_PATH,
      fallback: [
        "You are the refinement step for the assistant's thinking mode.",
        "",
        "Your job is to improve a draft answer using the user's question and the retrieved evidence.",
        "",
        "You must refine the draft, not answer the question from scratch.",
        "",
        "Rules:",
        "",
        "1. Preserve the meaning of supported claims from the draft.",
        "2. Remove or rewrite any parts that are unsupported by the retrieved evidence.",
        "3. Improve clarity, structure, and readability.",
        "4. Keep the answer faithful to the user's actual question.",
        "5. If the draft overstates certainty, make it more accurate and cautious.",
        "6. If evidence is partial, clearly state what is missing.",
        "7. If evidence is insufficient, clearly state that the knowledge base does not contain enough information.",
        "8. If additional general knowledge is included, label it explicitly as general knowledge.",
        "9. Do not invent new unsupported information during refinement.",
        "10. Do not output critique, explanation, or internal reasoning.",
        "",
        "Refinement goals:",
        "- make the answer clearer",
        "- make it more precise",
        "- make it more consistent with the evidence",
        "- keep it concise but helpful",
        "",
        "Output:",
        "- return only the final improved answer",
      ].join("\n"),
      label: "Assistant refine final prompt",
    }),
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
  ];
}
