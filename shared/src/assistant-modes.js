import { loadPromptFile } from "./prompt-files.js";

export const ASSISTANT_PROMPTS_DIR = "/app/prompts";
const ASSISTANT_MODE_SIMPLE_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-mode-simple.md`;
const ASSISTANT_MODE_THINKING_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-mode-thinking.md`;
const ASSISTANT_REFINE_DRAFT_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-refine-draft.md`;
const ASSISTANT_REFINE_REFINING_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-refine-refining.md`;
const ASSISTANT_THINKING_ANALYSE_PLAN_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-thinking-analyse-plan.md`;
const ASSISTANT_THINKING_DRAFT_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-thinking-draft.md`;
const ASSISTANT_THINKING_REFINING_PATH = `${ASSISTANT_PROMPTS_DIR}/assistant-thinking-refining.md`;

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

const THINKING_ANALYSE_PLAN_PROMPT = loadPromptFile({
  filePath: ASSISTANT_THINKING_ANALYSE_PLAN_PATH,
  fallback: [
    "You are the planning step for the assistant's thinking mode.",
    "",
    "Your task is to create a short internal plan for answering the user's question using the provided retrieved evidence, recent conversation context, and uploaded prompt files if any.",
    "",
    "Do not answer the user's question yet.",
    "",
    "Your plan must help the next step produce a correct, complete, evidence-grounded answer.",
    "",
    "Instructions:",
    "",
    "1. Identify what the user is actually asking for.",
    "2. Try to predict the next user question, and try to caputre this too in your plan for answering.",
    "3. Break the user request into the main parts that need to be addressed.",
    "4. Determine which parts appear supported by the retrieved evidence.",
    "5. Identify any gaps, uncertainties, or missing information.",
    "6. Create a short answer plan in a logical order.",
    "7. Prefer evidence-grounded coverage over speculation.",
    "8. Do not invent unsupported facts.",
    "9. Do not write the final answer.",
    "",
    "Output format:",
    "Return only a short structured plan with these sections:",
    "",
    "Question intent:",
    "- ...",
    "",
    "Answer plan:",
    "- ...",
    "- ...",
    "- ...",
    "",
    "Evidence coverage:",
    "- Supported: ...",
    "- Uncertain or missing: ...",
    "",
    "Keep the plan concise and useful for the next step.",
    "Do not include chain-of-thought, long explanations, or a final answer.",
  ].join("\n"),
  label: "Assistant thinking analyse/plan prompt",
});

const THINKING_DRAFT_PROMPT = loadPromptFile({
  filePath: ASSISTANT_THINKING_DRAFT_PATH,
  fallback: [
    "You are the draft-generation step for the assistant's thinking mode.",
    "",
    "Your task is to write a first draft answer to the user's question using:",
    "- the retrieved evidence",
    "- the recent conversation context",
    "- any uploaded prompt files",
    "- and the provided internal plan",
    "",
    "Your goal is to produce a useful, evidence-grounded draft that covers the user's request as completely as the evidence allows.",
    "",
    "Instructions:",
    "",
    "1. Follow the provided plan.",
    "2. Answer the user's actual question directly.",
   " 3. Use retrieved evidence as the primary basis for claims.",
    "4. Cover all supported parts of the question.",
    "5. If some parts are only partially supported, say so clearly.",
    "6. If some parts are not supported by the evidence, clearly identify them as missing or uncertain.",
    "7. Do not invent unsupported facts.",
    "8. If additional general knowledge is used, label it explicitly as general knowledge.",
    "9. Focus first on correctness, relevance, and completeness.",
    "10. Do not include internal reasoning, planning notes, or meta commentary.",
    "",
    "Output:",
    "Return only the draft answer text.",
    "Do not return the plan again.",
    "Do not explain your process.",
  ].join("\n"),
  label: "Assistant thinking draft prompt",
});

const THINKING_REFINING_PROMPT = loadPromptFile({
  filePath: ASSISTANT_THINKING_REFINING_PATH,
  fallback: [
    "You are the refinement step for the assistant's thinking mode.",
    "",
    "Your task is to improve the draft answer using:",
    "- the original user question",
    "- the retrieved evidence",
    "- the internal plan",
    "- the draft answer",
    "",
    "You must refine the draft, not answer the question from scratch.",
    "",
    "Your goals are:",
    "- ensure the answer fully addresses the user's request as far as the evidence allows",
    "- ensure the draft follows the plan",
    "- ensure the answer is faithful to the evidence",
    "- improve clarity, structure, and readability",
    "",
    "Instructions:",
    "",
    "1. Check whether all important parts of the plan are addressed in the draft.",
    "2. If something is missing and is supported by the evidence, add it.",
    "3. If something is missing and is not supported by the evidence, clearly mark it as missing or uncertain.",
    "4. Remove or rewrite any unsupported or overstated claims.",
    "5. Keep the answer aligned with the user's actual question.",
    "6. Improve structure, clarity, flow, and conciseness.",
    "7. Preserve useful content from the draft where it is correct.",
    "8. Do not invent new unsupported information.",
    "9. If additional general knowledge is included, label it explicitly as general knowledge.",
    "10. Do not output critique, notes, or internal reasoning.",
    "",
    "Output:",
    "Return only the final improved answer.",
  ].join("\n"),
  label: "Assistant thinking refining prompt",
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

const THINKING_CHAIN_PROMPTS = {
  analyse_plan: [
    "[CHAIN STEP: ANALYSE_PLAN]",
    THINKING_ANALYSE_PLAN_PROMPT,
  ].join("\n"),
  drafting: [
    "[CHAIN STEP: DRAFT]",
    THINKING_DRAFT_PROMPT,
  ].join("\n"),
  refining: [
    "[CHAIN STEP: REFINE]",
    THINKING_REFINING_PROMPT,
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

export function getAssistantChainSystemPrompt(modeId, step) {
  const normalizedMode = String(modeId || "").trim().toLowerCase();
  const normalizedStep = String(step || "").trim().toLowerCase();
  if (normalizedMode === "thinking") {
    if (normalizedStep === "analyse_plan") {
      return THINKING_CHAIN_PROMPTS.analyse_plan;
    }
    if (normalizedStep === "drafting") {
      return THINKING_CHAIN_PROMPTS.drafting;
    }
    return THINKING_CHAIN_PROMPTS.refining;
  }

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

export function buildThinkingDraftPassMessages({ originalPrompt, analysisPlan }) {
  return [
    [
      "human",
      [
        "Original user prompt:",
        String(originalPrompt || "").trim(),
        "Step 1 output (analysis/plan):",
        String(analysisPlan || "(empty analysis/plan)").trim() || "(empty analysis/plan)",
      ].join("\n"),
    ],
  ];
}

export function buildThinkingRefinePassMessages({ originalPrompt, analysisPlan, draftAnswer }) {
  return [
    [
      "human",
      [
        "Original user prompt:",
        String(originalPrompt || "").trim(),
        "Step 1 output (analysis/plan):",
        String(analysisPlan || "(empty analysis/plan)").trim() || "(empty analysis/plan)",
        "Step 2 output (draft):",
        String(draftAnswer || "(empty draft)").trim() || "(empty draft)",
      ].join("\n"),
    ],
  ];
}
