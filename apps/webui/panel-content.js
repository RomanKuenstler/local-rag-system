import React from "https://esm.sh/react@18";

function GeneralDropdown({
  label,
  currentId,
  options,
  kind,
  interactionDisabled,
  isOptionDisabled,
  applyPersonalizationChange,
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
    React.createElement("span", { className: "general-setting-label" }, label),
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
                applyPersonalizationChange(kind, optionId);
                setIsOpen(false);
              },
            },
            React.createElement(
              "span",
              { className: "general-dropdown-option-copy" },
              React.createElement("strong", null, optionId),
              React.createElement("small", null, option.shortDescription || option.description || "")
            ),
            active ? React.createElement("span", { className: "general-dropdown-check", "aria-hidden": "true" }, check) : null
          );
        })
      )
    )
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
  icon,
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
  const renderModeDropdown = ({ label, currentId, options, kind, isOptionDisabled }) => React.createElement(
    GeneralDropdown,
    {
      label,
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
      React.createElement(
        "section",
        { className: "config-section config-table-card" },
        React.createElement("h4", null, "Change now (no restart)"),
        React.createElement(
          "div",
          { className: "config-table" },
          React.createElement(
            "div",
            { className: "config-table-head" },
            React.createElement("span", null, "Setting"),
            React.createElement("span", null, "Value"),
            React.createElement("span", null, "Apply")
          ),
          ...editableConfigRows.map((entry) => React.createElement(
            "div",
            { key: `editable-${entry.section}-${entry.key}`, className: "config-table-row" },
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
              }),
              React.createElement("button", { type: "submit", disabled: isSending || !isEmbeddingReady }, "Apply")
            ),
            React.createElement("span", { className: "config-row-ready" }, "Live")
          ))
        )
      ),
      React.createElement(
        "section",
        { className: "config-section config-table-card" },
        React.createElement(
          "div",
          { className: "config-table-header" },
          React.createElement("h4", null, "Restart required"),
          React.createElement(
            "button",
            { type: "button", className: "restart-button", disabled: true },
            icon("M12 6V3l-4 4 4 4V8c2.8 0 5 2.2 5 5a5 5 0 0 1-8.7 3.3l-1.4 1.4A7 7 0 0 0 19 13c0-3.9-3.1-7-7-7"),
            "Restart"
          )
        ),
        React.createElement(
          "div",
          { className: "config-table" },
          React.createElement(
            "div",
            { className: "config-table-head" },
            React.createElement("span", null, "Setting"),
            React.createElement("span", null, "Value")
          ),
          ...restartConfigRows.map((entry) => React.createElement(
            "div",
            { key: `restart-${entry.section}-${entry.key}`, className: "config-table-row static" },
            React.createElement(
              "div",
              { className: "config-setting-cell" },
              React.createElement("strong", null, entry.key),
              React.createElement("small", null, entry.section)
            ),
            React.createElement("strong", { className: "config-static-value" }, String(entry.value))
          ))
        )
      ),
      React.createElement("p", { className: "config-help" }, panelData.configView.help)
    );
  }

  if (panelData.command === "/info") {
    return React.createElement(
      "div",
      { className: "info-groups" },
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "Status"),
        React.createElement(
          "div",
          { className: "info-row" },
          React.createElement("span", null, "retriever"),
          React.createElement(
            "strong",
            null,
            React.createElement("span", { className: `status-badge ${retrieverStatus}` }, retrieverStatus)
          )
        ),
        React.createElement(
          "div",
          { className: "info-row" },
          React.createElement("span", null, "embedder"),
          React.createElement(
            "strong",
            null,
            React.createElement("span", { className: `status-badge ${embedderStatus}` }, embedderStatus)
          )
        ),
        React.createElement(
          "p",
          { className: "config-help" },
          "Includes runtime model selection, vector/postgres storage wiring, and state-file paths."
        )
      ),
      ...parsedInfoGroups.map((group) => React.createElement(
        "section",
        { key: group.title, className: "info-group-card" },
        React.createElement("h4", null, group.title),
        ...group.items.map((item) => React.createElement(
          "div",
          { key: `${group.title}-${item.key}`, className: "info-row" },
          React.createElement("span", null, item.key),
          React.createElement("strong", null, item.value)
        ))
      ))
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
    const uiModes = panelData.content.ui?.modes || [];
    const currentUiMode = panelData.content.ui?.currentMode || null;
    const assistantModes = panelData.content.assistant?.modes || [];
    const currentAssistantMode = panelData.content.assistant?.currentMode || null;
    return React.createElement(
      "div",
      { className: "info-groups general-settings-grid" },
      React.createElement(
        "section",
        { className: "info-group-card general-settings-card" },
        renderModeDropdown({
          label: "UI-Mode",
          currentId: currentUiMode,
          options: uiModes,
          kind: "ui",
          isOptionDisabled: null,
        }),
        renderModeDropdown({
          label: "Assistant mode",
          currentId: currentAssistantMode,
          options: assistantModes,
          kind: "assistant",
          isOptionDisabled: (optionId) => disabledAssistantModeSet.has(optionId),
        })
      )
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
            React.createElement("h4", null, section.title),
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
            { key: section.id, className: "info-group-card personalization-section-card" },
            React.createElement("h4", null, section.title),
            React.createElement("h5", { className: "personalization-subheadline" }, "Personal details"),
            React.createElement(
              "div",
              { className: "personalization-custom-instructions-row" },
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("input", {
                  className: "personalization-custom-instructions-input",
                  value: nicknameValue,
                  placeholder: "Nickname",
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
              { className: "personalization-custom-instructions-row" },
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("input", {
                  className: "personalization-custom-instructions-input",
                  value: occupationValue,
                  placeholder: "Occupation",
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
              { className: "personalization-custom-instructions-row" },
              React.createElement(
                "div",
                { className: "personalization-custom-instructions-input-shell" },
                React.createElement("textarea", {
                  className: "personalization-custom-instructions-input",
                  value: moreAboutUserValue,
                  placeholder: "More about you",
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
          renderModeDropdown({
            label: section.settings.baseStyleTone.label,
            currentId: section.settings.baseStyleTone.currentId,
            options: section.settings.baseStyleTone.options,
            kind: "personalization:baseStyleTone",
          }),
          React.createElement("h5", { className: "personalization-subheadline" }, "Characteristics"),
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

  if ((panelData.command === "/help" || panelData.command === "?") && parsedHelpPanel) {
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
