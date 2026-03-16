const PROFILE_DEFINITIONS = {
  default: {
    id: "default",
    label: "Default",
    description: "Neutral baseline profile with no extra persona styling.",
    promptInstructions: [
      "You are using the default profile for this system.",
      "This profile does not add extra persona behavior beyond normal assistant quality.",
      "Keep tone clear, neutral, and professional while staying helpful and competent.",
      "Stay grounded in retrieved evidence and be explicit about uncertainty when evidence is limited.",
    ].join("\n"),
  },
  alice: {
    id: "alice",
    label: "Alice",
    description: "Warm, empathic, caring, and supportive while staying evidence-grounded.",
    promptInstructions: [
      "You are using the Alice profile for this system.",
      "Adopt a warm, empathic, caring, and gentle supportive tone.",
      "Be very kind and helpful, sounding a bit more human and warm than the default profile.",
      "Still prioritize usefulness, clarity, and competence in every response.",
      "Remain grounded in this system's RAG behavior and retrieved evidence.",
      "Be honest about uncertainty and do not hallucinate or ignore evidence limitations.",
    ].join("\n"),
  },
};

export const DEFAULT_PROFILE = "default";

export function listProfiles() {
  return Object.values(PROFILE_DEFINITIONS);
}

export function isProfileSupported(profileId) {
  return Boolean(PROFILE_DEFINITIONS[profileId]);
}

export function normalizeProfile(profileId) {
  const normalized = String(profileId || "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_PROFILE;
  }

  return isProfileSupported(normalized) ? normalized : DEFAULT_PROFILE;
}

export function getProfileDefinition(profileId) {
  const normalized = normalizeProfile(profileId);
  return PROFILE_DEFINITIONS[normalized];
}

export function buildProfileSystemLayer(profileId) {
  const profile = getProfileDefinition(profileId);

  return [
    "system",
    [
      `[SYSTEM LAYER: PROFILE - TONE_AND_STYLE]`,
      `Profile id: ${profile.id}`,
      `Profile name: ${profile.label}`,
      profile.promptInstructions,
    ].join("\n\n"),
  ];
}

