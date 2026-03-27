import React from "react";

const ATTACHMENT_EXTENSION_COLOR_CLASS = {
  pdf: "is-red",
  epub: "is-red",
  md: "is-gray",
  txt: "is-gray",
  html: "is-blue",
  htm: "is-blue",
  png: "is-purple",
  jpg: "is-purple",
  jpeg: "is-purple",
  webp: "is-purple",
  csv: "is-green",
};

function getExtensionColorClass(extensionValue) {
  const normalized = String(extensionValue || "").trim().replace(/^\./, "").toLowerCase();
  return ATTACHMENT_EXTENSION_COLOR_CLASS[normalized] || "is-gray";
}

function GeneralDropdown({
  label,
  description = "",
  currentId,
  options,
  kind,
  interactionDisabled,
  isOptionDisabled,
  applyPersonalizationChange,
  onSelectOption,
  chevron,
  check,
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const normalizedCurrentId = String(currentId || "").trim().toLowerCase();
  const activeOption = options.find((option) => String(option.id || "").trim().toLowerCase() === normalizedCurrentId) || null;
  const triggerLabel = activeOption?.label || activeOption?.id || normalizedCurrentId || "unknown";

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return React.createElement(
    "div",
    { className: "general-setting-row", key: `setting-${kind}-${label}` },
    React.createElement(
      "span",
      { className: "general-setting-label-wrap" },
      React.createElement("span", { className: "general-setting-label" }, label),
      description ? React.createElement("small", { className: "general-setting-description" }, description) : null
    ),
    React.createElement(
      "details",
      {
        className: "general-dropdown",
        open: isOpen,
        ref: rootRef,
      },
      React.createElement(
        "summary",
        {
          className: "general-dropdown-trigger",
          onClick: (event) => {
            event.preventDefault();
            setIsOpen((prev) => !prev);
          },
        },
        React.createElement("span", { className: "general-dropdown-value" }, triggerLabel),
        React.createElement("span", { className: "general-dropdown-chevron", "aria-hidden": "true" }, chevron)
      ),
      React.createElement(
        "div",
        { className: "general-dropdown-menu", role: "menu" },
        ...options.map((option) => {
          const optionId = String(option.id || "").trim().toLowerCase();
          const active = optionId === String(currentId || "").trim().toLowerCase();
          const optionDisabled = Boolean(isOptionDisabled?.(optionId));

          return React.createElement(
            "button",
            {
              key: `${kind}-${optionId}`,
              type: "button",
              className: `general-dropdown-option${active ? " active" : ""}`,
              role: "menuitemradio",
              "aria-checked": active ? "true" : "false",
              disabled: interactionDisabled || optionDisabled,
              onClick: (event) => {
                event.preventDefault();
                if (typeof onSelectOption === "function") {
                  onSelectOption(optionId);
                } else {
                  applyPersonalizationChange(kind, optionId);
                }
                setIsOpen(false);
              },
            },
            React.createElement(
              "span",
              { className: "general-dropdown-option-copy" },
              React.createElement("strong", null, option.label || optionId),
              React.createElement("small", null, option.shortDescription || option.description || "")
            ),
            active ? React.createElement("span", { className: "general-dropdown-check", "aria-hidden": "true" }, check) : null
          );
        })
      )
    )
  );
}

function VoiceSettingRow({ currentId, options, onSelectOption, chevron, check }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const normalizedCurrentId = String(currentId || "").trim().toLowerCase();
  const activeOption = options.find((option) => String(option.id || "").trim().toLowerCase() === normalizedCurrentId) || null;
  const triggerLabel = activeOption?.label || activeOption?.id || normalizedCurrentId || "Default";

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return React.createElement(
    "div",
    { className: "general-setting-row", key: "setting-general-voice" },
    React.createElement(
      "span",
      { className: "general-setting-label-wrap" },
      React.createElement("span", { className: "general-setting-label" }, "Voice"),
      React.createElement("small", { className: "general-setting-description" }, "Currently under development")
    ),
    React.createElement(
      "div",
      { className: "general-setting-controls", ref: rootRef },
      React.createElement(
        "button",
        {
          type: "button",
          className: "general-play-button",
          "aria-label": "Play voice preview",
        },
        "▶",
        " ",
        "Play"
      ),
      React.createElement(
        "details",
        {
          className: "general-dropdown general-dropdown-voice",
          open: isOpen,
        },
        React.createElement(
          "summary",
          {
            className: "general-dropdown-trigger",
            onClick: (event) => {
              event.preventDefault();
              setIsOpen((prev) => !prev);
            },
          },
          React.createElement("span", { className: "general-dropdown-value" }, triggerLabel),
          React.createElement("span", { className: "general-dropdown-chevron", "aria-hidden": "true" }, chevron)
        ),
        React.createElement(
          "div",
          { className: "general-dropdown-menu", role: "menu" },
          ...options.map((option) => {
            const optionId = String(option.id || "").trim().toLowerCase();
            const active = optionId === normalizedCurrentId;
            return React.createElement(
              "button",
              {
                key: `voice-${optionId}`,
                type: "button",
                className: `general-dropdown-option${active ? " active" : ""}`,
                role: "menuitemradio",
                "aria-checked": active ? "true" : "false",
                onClick: (event) => {
                  event.preventDefault();
                  onSelectOption(optionId);
                  setIsOpen(false);
                },
              },
              React.createElement("span", { className: "general-dropdown-option-copy" }, React.createElement("strong", null, option.label || optionId)),
              active ? React.createElement("span", { className: "general-dropdown-check", "aria-hidden": "true" }, check) : null
            );
          })
        )
      )
    )
  );
}

function GeneralPreviewSettings({ assistantModes, currentAssistantMode, renderModeDropdown, chevron, check }) {
  const [appearance, setAppearance] = React.useState("system");
  const [language, setLanguage] = React.useState("auto-detect");
  const [spokenLanguage, setSpokenLanguage] = React.useState("auto-detect");
  const [voice, setVoice] = React.useState("default");

  const appearanceOptions = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  const languageOptions = [
    { id: "auto-detect", label: "Auto-detect" },
    { id: "english", label: "English" },
    { id: "german", label: "German" },
    { id: "spanish", label: "Spanish" },
    { id: "french", label: "French" },
  ];
  const voiceOptions = [
    { id: "default", label: "Default" },
    { id: "male", label: "Male" },
    { id: "female", label: "Female" },
  ];

  return React.createElement(
    "section",
    { className: "info-group-card general-settings-card" },
    renderModeDropdown({
      label: "Assistant mode",
      currentId: currentAssistantMode,
      options: assistantModes,
      kind: "assistant",
    }),
    React.createElement(GeneralDropdown, {
      label: "Appearance",
      description: "Currently under development",
      currentId: appearance,
      options: appearanceOptions,
      kind: "appearance",
      interactionDisabled: false,
      applyPersonalizationChange: null,
      onSelectOption: setAppearance,
      chevron,
      check,
    }),
    React.createElement(GeneralDropdown, {
      label: "Language",
      description: "Currently under development",
      currentId: language,
      options: languageOptions,
      kind: "language",
      interactionDisabled: false,
      applyPersonalizationChange: null,
      onSelectOption: setLanguage,
      chevron,
      check,
    }),
    React.createElement(GeneralDropdown, {
      label: "Spoken language",
      description: "Currently under development",
      currentId: spokenLanguage,
      options: languageOptions,
      kind: "spoken-language",
      interactionDisabled: false,
      applyPersonalizationChange: null,
      onSelectOption: setSpokenLanguage,
      chevron,
      check,
    }),
    React.createElement(VoiceSettingRow, {
      currentId: voice,
      options: voiceOptions,
      onSelectOption: setVoice,
      chevron,
      check,
    })
  );
}

export function renderPanelContent({
  panelData,
  parsedInfoGroups,
  parsedAssistantPanel,
  parsedHelpPanel,
  editableConfigRows,
  restartConfigRows,
  retrieverStatus,
  embedderStatus,
  serviceStatuses = {},
  isSending,
  isEmbeddingReady,
  disabledAssistantModes = [],
  submitConfigChange,
  applyPersonalizationChange,
  customInstructionsDraft,
  isCustomInstructionsDirty,
  updateCustomInstructionsDraft,
  saveCustomInstructions,
  nicknameDraft,
  occupationDraft,
  moreAboutUserDraft,
  isNicknameDirty,
  isOccupationDirty,
  isMoreAboutUserDirty,
  updateNicknameDraft,
  updateOccupationDraft,
  updateMoreAboutUserDraft,
  saveNickname,
  saveOccupation,
  saveMoreAboutUser,
  tagFilterRows = [],
  tagFilterEnabledByTag = {},
  globalTagFilterEnabledByTag = tagFilterEnabledByTag,
  filterScope = "global",
  toggleTagFilter,
  isTagFilterSaving = false,
  icon,
  settingsTabError = "",
  clearSettingsTabError = () => {},
  settingsInputResetTokenByKey = {},
}) {
  const interactionDisabled = isSending || !isEmbeddingReady;
  const disabledAssistantModeSet = new Set(
    Array.isArray(disabledAssistantModes)
      ? disabledAssistantModes.map((modeId) => String(modeId || "").trim().toLowerCase())
      : []
  );

  const renderSelectableModeCard = ({ key, id, description, isActive, onSelect, isDisabled = false }) => React.createElement(
    "button",
    {
      key,
      type: "button",
      className: `assistant-mode-card mode-select-button ${isActive ? "active" : ""}`,
      onClick: () => onSelect(id),
      disabled: interactionDisabled || isDisabled,
      "aria-pressed": isActive,
    },
    React.createElement("strong", null, id),
    React.createElement("p", null, description)
  );
  const chevron = "▾";
  const check = "✓";
  const saveIconPath = "M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14V7zm-7 0v4h4V3zm8 18H6v-6h12zm0-8H6V5h2v4h8V5h2z";
  const customInstructionsValue = String(customInstructionsDraft || "");
  const customInstructionsDisabled = interactionDisabled || !isCustomInstructionsDirty;
  const nicknameValue = String(nicknameDraft || "");
  const occupationValue = String(occupationDraft || "");
  const moreAboutUserValue = String(moreAboutUserDraft || "");
  const nicknameSaveDisabled = interactionDisabled || !isNicknameDirty;
  const occupationSaveDisabled = interactionDisabled || !isOccupationDirty;
  const moreAboutUserSaveDisabled = interactionDisabled || !isMoreAboutUserDirty;
  const autoResizeTextarea = (element) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 24)}px`;
  };
  const renderModeDropdown = ({ label, description, currentId, options, kind, isOptionDisabled }) => React.createElement(
    GeneralDropdown,
    {
      label,
      description,
      currentId,
      options,
      kind,
      interactionDisabled,
      isOptionDisabled,
      applyPersonalizationChange,
      chevron,
      check,
    }
  );

  if (panelData.command === "/config" && panelData.configView) {
    return React.createElement(
      "div",
      { className: "config-sections" },
      settingsTabError
        ? React.createElement("p", { className: "config-settings-error", role: "alert" }, settingsTabError)
        : null,
      React.createElement(
        "section",
        { className: "library-table-card config-live-table-card" },
        React.createElement(
          "div",
          { className: "library-table config-live-table", role: "table", "aria-label": "Settings that apply immediately" },
          React.createElement(
            "div",
            { className: "library-table-head config-live-table-head", role: "row" },
            React.createElement("span", null, "Setting"),
            React.createElement("span", null, "Value")
          ),
          React.createElement(
            "div",
            { className: "library-table-body", role: "rowgroup" },
            ...editableConfigRows.map((entry) => React.createElement(
              "div",
              { key: `editable-${entry.section}-${entry.key}`, className: "library-table-row config-live-table-row", role: "row" },
              React.createElement(
                "div",
                { className: "config-setting-cell" },
                React.createElement("strong", null, entry.key),
                React.createElement("small", null, entry.section)
              ),
              React.createElement(
                "form",
                {
                  className: "config-edit-form",
                  key: `config-form-${String(entry.key || "").trim().toLowerCase()}-${settingsInputResetTokenByKey[String(entry.key || "").trim().toLowerCase()] || 0}`,
                  onSubmit: async (event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    await submitConfigChange(entry.key, formData.get("value"));
                  },
                },
                React.createElement("input", {
                  name: "value",
                  defaultValue: String(entry.value),
                  className: "config-input",
                  disabled: isSending || !isEmbeddingReady,
                  onChange: () => clearSettingsTabError(),
                }),
                React.createElement(
                  "button",
                  {
                    type: "submit",
                    className: "personalization-custom-save-button active config-apply-save-button",
                    disabled: isSending || !isEmbeddingReady,
                    "aria-label": `Save ${entry.key}`,
                    title: `Save ${entry.key}`,
                  },
                  icon(saveIconPath)
                )
              )
            ))
          )
        )
      )
    );
  }

  if (panelData.command === "/info") {
    const storageGroup = parsedInfoGroups.find((group) => String(group?.title || "").trim().toLowerCase() === "storage");
    const appGroupTitle = "app";
    const vectorDbValue = storageGroup?.items?.find((item) => String(item?.key || "").trim().toLowerCase() === "vector db")?.value || "";
    const postgresValue = storageGroup?.items?.find((item) => String(item?.key || "").trim().toLowerCase() === "postgres")?.value || "";
    const embeddableExtensionsValue = storageGroup?.items?.find((item) => String(item?.key || "").trim().toLowerCase() === "embeddable extensions")?.value || "";
    const embeddableExtensions = embeddableExtensionsValue
      .split(",")
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    const normalizeStorageStatus = (value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized || normalized === "n/a" || normalized === "not configured") {
        return "disconnected";
      }
      return "active";
    };
    const infoServiceRows = [
      {
        key: "backend",
        label: "backend",
        status: serviceStatuses.backend || "active",
        description: "Web API gateway handling authentication, sessions, and orchestration.",
      },
      {
        key: "retriever",
        label: "retriever",
        status: serviceStatuses.retriever || retrieverStatus,
        description: "Runs retrieval, prompt assembly, and /info /config command handling.",
      },
      {
        key: "embedder",
        label: "embedder",
        status: serviceStatuses.embedder || embedderStatus,
        description: "Processes library documents and generates embeddings for semantic search.",
      },
      {
        key: "ocr-scanner",
        label: "ocr scanner",
        status: serviceStatuses.ocrScanner || "disconnected",
        description: "Extracts text from scanned PDFs and images for retrieval and embedding.",
      },
      {
        key: "vector-db",
        label: "vector db",
        status: normalizeStorageStatus(vectorDbValue),
        description: "Stores vector embeddings used for nearest-neighbor retrieval.",
      },
      {
        key: "postgres",
        label: "postgres",
        status: normalizeStorageStatus(postgresValue),
        description: "Stores chat/session data, app metadata, and relational state.",
      },
    ];

    return React.createElement(
      "div",
      { className: "info-groups" },
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "Status"),
        ...infoServiceRows.map((service) => React.createElement(
          "div",
          { key: service.key, className: "info-row info-service-row" },
          React.createElement(
            "span",
            { className: "info-service-meta" },
            React.createElement("strong", null, service.label),
            React.createElement("small", null, service.description)
          ),
          React.createElement(
            "strong",
            null,
            React.createElement("span", { className: `status-badge ${service.status}` }, service.status)
          )
        ))
      ),
      ...parsedInfoGroups
        .filter((group) => {
          const normalizedTitle = String(group?.title || "").trim().toLowerCase();
          return normalizedTitle !== appGroupTitle && normalizedTitle !== "state";
        })
        .map((group) => {
          if (String(group.title || "").trim().toLowerCase() === "storage") {
            return React.createElement(
              "section",
              { key: group.title, className: "info-group-card" },
              React.createElement("h4", null, group.title),
              React.createElement(
                "div",
                { className: "info-row" },
                React.createElement("span", null, "Knowledge base"),
                React.createElement("strong", null, "Qdrant")
              ),
              React.createElement(
                "div",
                { className: "info-row" },
                React.createElement("span", null, "Persistent storage"),
                React.createElement("strong", null, "Postgres")
              ),
              React.createElement(
                "div",
                { className: "info-row" },
                React.createElement("span", null, "Embeddable files"),
                React.createElement(
                  "strong",
                  { className: "info-extension-chip-row" },
                  ...(embeddableExtensions.length
                    ? embeddableExtensions.map((extension) => React.createElement(
                      "span",
                      { key: `embeddable-${extension}`, className: `library-extension-chip ${getExtensionColorClass(extension)}` },
                      extension
                    ))
                    : [React.createElement("span", { key: "embeddable-empty" }, "n/a")])
                )
              )
            );
          }
          return React.createElement(
        "section",
        { key: group.title, className: "info-group-card" },
        React.createElement("h4", null, group.title),
        ...group.items.map((item) => React.createElement(
          "div",
          { key: `${group.title}-${item.key}`, className: "info-row" },
          React.createElement("span", null, item.key),
          React.createElement("strong", null, item.value)
        ))
          );
        })
    );
  }

  if (panelData.command === "/assistant" && parsedAssistantPanel) {
    return React.createElement(
      "div",
      { className: "assistant-mode-grid" },
      parsedAssistantPanel.currentMode
        ? React.createElement("div", { className: "assistant-current" }, `Current mode: ${parsedAssistantPanel.currentMode}`)
        : null,
      ...parsedAssistantPanel.modes.map((mode) => renderSelectableModeCard({
        key: mode.id,
        id: mode.id,
        description: mode.description,
        isActive: mode.id === parsedAssistantPanel.currentMode,
        onSelect: (id) => applyPersonalizationChange("assistant", id),
      }))
    );
  }

  if (panelData.command === "/general" && panelData.content) {
    const assistantModes = panelData.content.assistant?.modes || [];
    const currentAssistantMode = panelData.content.assistant?.currentMode || null;
    return React.createElement(
      "div",
      { className: "info-groups general-settings-grid" },
      React.createElement(GeneralPreviewSettings, {
        assistantModes,
        currentAssistantMode,
        chevron,
        check,
        renderModeDropdown: ({ label, currentId, options, kind }) => renderModeDropdown({
          label,
          currentId,
          options,
          kind,
          isOptionDisabled: (optionId) => disabledAssistantModeSet.has(optionId),
        }),
      })
    );
  }

  if (panelData.command === "/personalization" && panelData.content) {
    const sections = Array.isArray(panelData.content.sections) ? panelData.content.sections : [];
    return React.createElement(
      "div",
      { className: "info-groups" },
      ...sections.map((section) => {
        if (section.id === "custom-instructions") {
          return React.createElement(
            "section",
            { key: section.id, className: "info-group-card personalization-section-card" },
            React.createElement("h5", { className: "personalization-option-heading" }, section.title),
            React.createElement(
              "div",
              { className: "personalization-custom-instructions-row" },
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("textarea", {
                  className: "personalization-custom-instructions-input",
                  value: customInstructionsValue,
                  placeholder: "Additional behavior, style, and tone preferences",
                  rows: 1,
                  onChange: (event) => {
                    autoResizeTextarea(event.currentTarget);
                    updateCustomInstructionsDraft(event.currentTarget.value);
                  },
                  ref: autoResizeTextarea,
                  disabled: interactionDisabled,
                  "aria-label": "Custom instructions",
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `personalization-custom-save-button${customInstructionsDisabled ? "" : " active"}`,
                    onClick: saveCustomInstructions,
                    disabled: customInstructionsDisabled,
                    "aria-label": "Save custom instructions",
                    title: "Save custom instructions",
                  },
                  icon(saveIconPath)
                )
              )
            )
          );
        }

        if (section.id === "about-you") {
          return React.createElement(
            "section",
            { key: section.id, className: "info-group-card personalization-section-card personalization-about-you-card" },
            React.createElement("h4", null, section.title),
            React.createElement("div", { className: "personalization-section-divider", "aria-hidden": "true" }),
            React.createElement(
              "div",
              { className: "personalization-custom-instructions-row personalization-about-you-row" },
              React.createElement("label", { className: "personalization-field-label", htmlFor: "personalization-nickname-input" }, "Nickname"),
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("input", {
                  id: "personalization-nickname-input",
                  className: "personalization-custom-instructions-input",
                  value: nicknameValue,
                  placeholder: "What should the assistant call you?",
                  onChange: (event) => updateNicknameDraft(event.currentTarget.value),
                  disabled: interactionDisabled,
                  "aria-label": "Nickname",
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `personalization-custom-save-button${nicknameSaveDisabled ? "" : " active"}`,
                    onClick: saveNickname,
                    disabled: nicknameSaveDisabled,
                    "aria-label": "Save nickname",
                    title: "Save nickname",
                  },
                  icon(saveIconPath)
                )
              )
            ),
            React.createElement(
              "div",
              { className: "personalization-custom-instructions-row personalization-about-you-row" },
              React.createElement("label", { className: "personalization-field-label", htmlFor: "personalization-occupation-input" }, "Occupation"),
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("input", {
                  id: "personalization-occupation-input",
                  className: "personalization-custom-instructions-input",
                  value: occupationValue,
                  placeholder: "What do you do?",
                  onChange: (event) => updateOccupationDraft(event.currentTarget.value),
                  disabled: interactionDisabled,
                  "aria-label": "Occupation",
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `personalization-custom-save-button${occupationSaveDisabled ? "" : " active"}`,
                    onClick: saveOccupation,
                    disabled: occupationSaveDisabled,
                    "aria-label": "Save occupation",
                    title: "Save occupation",
                  },
                  icon(saveIconPath)
                )
              )
            ),
            React.createElement(
              "div",
              { className: "personalization-custom-instructions-row personalization-about-you-row" },
              React.createElement("label", { className: "personalization-field-label", htmlFor: "personalization-about-user-input" }, "More about you"),
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("textarea", {
                  id: "personalization-about-user-input",
                  className: "personalization-custom-instructions-input",
                  value: moreAboutUserValue,
                  placeholder: "Anything else that helps personalize responses",
                  rows: 1,
                  onChange: (event) => {
                    autoResizeTextarea(event.currentTarget);
                    updateMoreAboutUserDraft(event.currentTarget.value);
                  },
                  ref: autoResizeTextarea,
                  disabled: interactionDisabled,
                  "aria-label": "More about you",
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `personalization-custom-save-button${moreAboutUserSaveDisabled ? "" : " active"}`,
                    onClick: saveMoreAboutUser,
                    disabled: moreAboutUserSaveDisabled,
                    "aria-label": "Save more about you",
                    title: "Save more about you",
                  },
                  icon(saveIconPath)
                )
              )
            )
          );
        }

        if (section.id !== "personalization" || !section.settings) {
          return React.createElement(
            "section",
            { key: section.id, className: "info-group-card personalization-section-card" },
            React.createElement("h4", null, section.title),
            React.createElement("p", { className: "config-help" }, section.description || "")
          );
        }

        return React.createElement(
          "section",
          { key: section.id, className: "info-group-card general-settings-card personalization-settings-card" },
          React.createElement("h4", null, section.title),
          React.createElement("div", { className: "personalization-section-divider", "aria-hidden": "true" }),
          renderModeDropdown({
            label: section.settings.baseStyleTone.label,
            description: "Set the style and tone of how the assistant responds to you.",
            currentId: section.settings.baseStyleTone.currentId,
            options: section.settings.baseStyleTone.options,
            kind: "personalization:baseStyleTone",
          }),
          React.createElement(
            "div",
            { className: "personalization-subheadline-block" },
            React.createElement("h5", { className: "personalization-subheadline" }, "Characteristics"),
            React.createElement(
              "p",
              { className: "personalization-subheadline-description" },
              "Choose additional customizations on top of your base style and tone."
            )
          ),
          renderModeDropdown({
            label: section.settings.warm.label,
            currentId: section.settings.warm.currentId,
            options: section.settings.warm.options,
            kind: "personalization:warm",
          }),
          renderModeDropdown({
            label: section.settings.enthusiastic.label,
            currentId: section.settings.enthusiastic.currentId,
            options: section.settings.enthusiastic.options,
            kind: "personalization:enthusiastic",
          }),
          renderModeDropdown({
            label: section.settings.headersAndLists.label,
            currentId: section.settings.headersAndLists.currentId,
            options: section.settings.headersAndLists.options,
            kind: "personalization:headersAndLists",
          })
        );
      })
    );
  }


  if (panelData.command === "/filter") {
    const rows = Array.isArray(tagFilterRows) ? tagFilterRows : [];
    const normalizedScope = String(filterScope || "global").trim().toLowerCase();
    const isChatScopedFilter = normalizedScope === "chat";
    return React.createElement(
      "section",
      { className: "filter-table-wrapper" },
      React.createElement(
        "div",
        { className: "filter-table", role: "table", "aria-label": "Tag filters" },
        React.createElement(
          "div",
          { className: "filter-table-head", role: "row" },
          React.createElement("strong", { role: "columnheader" }, "Tag"),
          React.createElement("strong", { role: "columnheader" }, "Files"),
          React.createElement("strong", { role: "columnheader", className: "filter-action-header" }, "Action")
        ),
        rows.length === 0
          ? React.createElement("p", { className: "archive-empty" }, "No tags available yet.")
          : rows.map((row) => {
            const globallyEnabled = globalTagFilterEnabledByTag[row.tag] ?? true;
            const enabled = isChatScopedFilter
              ? (globallyEnabled ? (tagFilterEnabledByTag[row.tag] ?? true) : false)
              : (tagFilterEnabledByTag[row.tag] ?? true);
            const isLockedByGlobalFilter = isChatScopedFilter && !globallyEnabled;
            return React.createElement(
              "div",
              { key: row.tag, className: "filter-table-row", role: "row" },
              React.createElement("strong", { className: "filter-tag-name" }, row.tag),
              React.createElement("span", { className: "filter-tag-count" }, String(row.fileCount || 0)),
              React.createElement(
                "label",
                { className: "filter-switch", title: isLockedByGlobalFilter ? "Disabled globally in Preferences → Filter" : enabled ? "Disable tag" : "Enable tag" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: enabled,
                  disabled: isTagFilterSaving || interactionDisabled || isLockedByGlobalFilter,
                  onChange: () => toggleTagFilter?.(row.tag),
                }),
                React.createElement("span", { className: "filter-switch-slider", "aria-hidden": "true" })
              )
            );
          })
      ),
      React.createElement(
        "p",
        { className: "filter-scope-note" },
        isChatScopedFilter
          ? "Tags disabled globally cannot be enabled here. To change global tag availability, open Preferences → Filter."
          : "Disabling tags here is global for your session and applies to every chat. Chat-level filter dialogs cannot enable globally disabled tags."
      )
    );
  }
  if ((panelData.command === "/help" || panelData.command === "?") && parsedHelpPanel) {
    if (Array.isArray(parsedHelpPanel.sections)) {
      return React.createElement(
        "div",
        { className: "help-grid" },
        ...parsedHelpPanel.sections.map((section, sectionIndex) => {
          const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
          const userInputNotes = Array.isArray(section?.userInputNotes) ? section.userInputNotes : [];
          const sectionExtensions = Array.isArray(section?.extensions) ? section.extensions : [];
          const assistantModes = Array.isArray(section?.assistantModes) ? section.assistantModes : [];
          return React.createElement(
            "section",
            { key: section?.id || `help-section-${sectionIndex}`, className: "info-group-card" },
            React.createElement("h4", null, section?.title || "Section"),
            ...paragraphs.map((line, idx) => React.createElement("p", { key: `help-section-${sectionIndex}-line-${idx}` }, line)),
            assistantModes.length
              ? React.createElement(
                React.Fragment,
                { key: `help-section-${sectionIndex}-assistant-modes` },
                React.createElement("h5", null, "Assistant modes"),
                React.createElement(
                  "div",
                  { className: "library-table help-assistant-modes-table", role: "table", "aria-label": "Assistant modes" },
                  React.createElement(
                    "div",
                    { className: "library-table-head help-assistant-modes-head", role: "row" },
                    React.createElement("span", null, "Mode"),
                    React.createElement("span", null, "Description")
                  ),
                  React.createElement(
                    "div",
                    { className: "library-table-body", role: "rowgroup" },
                    ...assistantModes.map((mode, idx) => React.createElement(
                      "div",
                      { key: `help-section-${sectionIndex}-assistant-mode-${idx}`, className: "library-table-row help-assistant-modes-row", role: "row" },
                      React.createElement("strong", null, mode?.label || "n/a"),
                      React.createElement("span", null, mode?.description || "")
                    ))
                  )
                )
              )
              : null,
            userInputNotes.length
              ? React.createElement(
                React.Fragment,
                { key: `help-section-${sectionIndex}-composer` },
                React.createElement("h5", null, section?.userInputHeading || "User input"),
                ...userInputNotes.map((note, idx) => React.createElement("p", { key: `help-section-${sectionIndex}-user-input-note-${idx}` }, note))
              )
              : null,
            sectionExtensions.length
              ? React.createElement(
                React.Fragment,
                { key: `help-section-${sectionIndex}-attachments` },
                React.createElement("h5", null, section?.extensionHeading || "File extensions"),
                React.createElement(
                  "div",
                  { className: "info-extension-chip-row" },
                  ...sectionExtensions.map((extension, idx) => {
                    const normalized = String(extension || "").trim().replace(/^\./, "").toLowerCase();
                    const colorClass = getExtensionColorClass(normalized);
                    return React.createElement(
                      "span",
                      { key: `help-section-${sectionIndex}-extension-${idx}`, className: `library-extension-chip ${colorClass}`.trim() },
                      `.${normalized}`
                    );
                  })
                )
              )
              : null
          );
        })
      );
    }

    return React.createElement(
      "div",
      { className: "help-grid" },
      parsedHelpPanel.intro.length
        ? React.createElement(
          "section",
          { className: "info-group-card" },
          React.createElement("h4", null, "Overview"),
          ...parsedHelpPanel.intro.map((line, idx) => React.createElement("p", { key: `help-intro-${idx}` }, line))
        )
        : null,
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "Commands"),
        React.createElement(
          "div",
          { className: "help-table" },
          React.createElement(
            "div",
            { className: "help-table-head" },
            React.createElement("span", null, "Command"),
            React.createElement("span", null, "What it does")
          ),
          ...parsedHelpPanel.commands.map((item, idx) => React.createElement(
            "div",
            { key: `help-command-${idx}`, className: "help-table-row" },
            React.createElement("code", null, item.command),
            React.createElement("span", null, item.description || "—")
          ))
        )
      ),
      parsedHelpPanel.tips.length
        ? React.createElement(
          "section",
          { className: "info-group-card" },
          React.createElement("h4", null, "Tips"),
          React.createElement(
            "ul",
            { className: "help-tips" },
            ...parsedHelpPanel.tips.map((tip, idx) => React.createElement("li", { key: `help-tip-${idx}` }, tip))
          )
        )
        : null
    );
  }

  if (Array.isArray(panelData.content)) {
    return React.createElement(
      "div",
      { className: "panel-text-block" },
      ...panelData.content.map((item, idx) => React.createElement("p", { key: `${panelData.id}-${idx}` }, item))
    );
  }

  if (typeof panelData.content === "object" && panelData.content !== null) {
    return Object.entries(panelData.content).map(([key, value]) => React.createElement(
      "div",
      { key, className: "info-row" },
      React.createElement("span", null, key),
      React.createElement("strong", null, typeof value === "object" ? JSON.stringify(value) : String(value))
    ));
  }

  return React.createElement("p", null, String(panelData.content || "No data available."));
}
