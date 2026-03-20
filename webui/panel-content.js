import React from "https://esm.sh/react@18";

export function renderPanelContent({
  panelData,
  parsedInfoGroups,
  parsedAssistantPanel,
  parsedProfilePanel,
  parsedHelpPanel,
  editableConfigRows,
  restartConfigRows,
  retrieverStatus,
  embedderStatus,
  isSending,
  isEmbeddingReady,
  submitConfigChange,
  applyPersonalizationChange,
  icon,
}) {
  const interactionDisabled = isSending || !isEmbeddingReady;

  const renderSelectableModeCard = ({ key, id, description, isActive, onSelect }) => React.createElement(
    "button",
    {
      key,
      type: "button",
      className: `assistant-mode-card mode-select-button ${isActive ? "active" : ""}`,
      onClick: () => onSelect(id),
      disabled: interactionDisabled,
      "aria-pressed": isActive,
    },
    React.createElement("strong", null, id),
    React.createElement("p", null, description)
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

  if (panelData.command === "/profile" && parsedProfilePanel) {
    return React.createElement(
      "div",
      { className: "assistant-mode-grid" },
      parsedProfilePanel.currentProfile
        ? React.createElement("div", { className: "assistant-current" }, `Current profile: ${parsedProfilePanel.currentProfile}`)
        : null,
      ...parsedProfilePanel.profiles.map((profile) => renderSelectableModeCard({
        key: profile.id,
        id: profile.id,
        description: profile.description,
        isActive: profile.id === parsedProfilePanel.currentProfile,
        onSelect: (id) => applyPersonalizationChange("profile", id),
      }))
    );
  }

  if (panelData.command === "/personalization" && panelData.content) {
    const uiModes = panelData.content.ui?.modes || [];
    const currentUiMode = panelData.content.ui?.currentMode || null;
    const assistantModes = panelData.content.assistant?.modes || [];
    const currentAssistantMode = panelData.content.assistant?.currentMode || null;
    const profiles = panelData.content.profile?.profiles || [];
    const currentProfile = panelData.content.profile?.currentProfile || null;

    return React.createElement(
      "div",
      { className: "info-groups" },
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "UI mode"),
        ...uiModes.map((mode) => renderSelectableModeCard({
          key: `personalization-ui-${mode.id}`,
          id: mode.id,
          description: mode.description,
          isActive: mode.id === currentUiMode,
          onSelect: (id) => applyPersonalizationChange("ui", id),
        }))
      ),
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "Assistant mode"),
        ...assistantModes.map((mode) => renderSelectableModeCard({
          key: `personalization-mode-${mode.id}`,
          id: mode.id,
          description: mode.description,
          isActive: mode.id === currentAssistantMode,
          onSelect: (id) => applyPersonalizationChange("assistant", id),
        }))
      ),
      React.createElement(
        "section",
        { className: "info-group-card" },
        React.createElement("h4", null, "Profile"),
        ...profiles.map((profile) => renderSelectableModeCard({
          key: `personalization-profile-${profile.id}`,
          id: profile.id,
          description: profile.description,
          isActive: profile.id === currentProfile,
          onSelect: (id) => applyPersonalizationChange("profile", id),
        }))
      )
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
