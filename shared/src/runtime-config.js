export function parseIntegerConfig(rawValue) {
  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseFloatConfig(rawValue) {
  const parsed = Number.parseFloat(String(rawValue));
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseConfigSetCommand(input) {
  const trimmed = String(input || "").trim();
  const noPrefix = trimmed.replace(/^\/config\s+set\s+/i, "").trim();

  const quotedMatch = noPrefix.match(/^['"](.+?)['"]\s*(?:=|\s+)\s*(.+)$/);
  if (quotedMatch) {
    return {
      configName: quotedMatch[1],
      rawValue: quotedMatch[2],
    };
  }

  const parts = noPrefix.split(/\s*=\s*|\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      configName: parts.slice(0, -1).join(" "),
      rawValue: parts[parts.length - 1],
    };
  }

  return null;
}

export function createRuntimeConfigManager(initialConfig, onHistoryMessagesChanged = () => {}) {
  const runtimeConfig = {
    ...initialConfig,
  };

  const runtimeConfigSchema = {
    "history messages": {
      key: "historyMessages",
      parse: parseIntegerConfig,
      validate: (value) => {
        if (!Number.isInteger(value) || value < 1) {
          return "must be an integer >= 1";
        }
        return null;
      },
    },
    "max similarities": {
      key: "maxSimilarities",
      parse: parseIntegerConfig,
      validate: (value, config) => {
        if (!Number.isInteger(value) || value < 1) {
          return "must be an integer >= 1";
        }
        if (value < config.minSimilarities) {
          return `must be >= min similarities (${config.minSimilarities})`;
        }
        return null;
      },
    },
    "min similarities": {
      key: "minSimilarities",
      parse: parseIntegerConfig,
      validate: (value, config) => {
        if (!Number.isInteger(value) || value < 0) {
          return "must be an integer >= 0";
        }
        if (value > config.maxSimilarities) {
          return `must be <= max similarities (${config.maxSimilarities})`;
        }
        return null;
      },
    },
    "cosine limit": {
      key: "cosineLimit",
      parse: parseFloatConfig,
      validate: (value) => {
        if (!Number.isFinite(value)) {
          return "must be a valid number";
        }
        if (value < 0 || value > 1) {
          return "must be between 0 and 1";
        }
        return null;
      },
    },
  };

  function getConfigFieldMetadata(name) {
    const normalized = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/["']/g, "")
      .replace(/\s+/g, " ");

    return runtimeConfigSchema[normalized] || null;
  }

  function setRuntimeConfigValue(configName, rawValue) {
    const field = getConfigFieldMetadata(configName);

    if (!field) {
      return {
        ok: false,
        message:
          `Unknown config \"${configName}\". Changeable keys: ` +
          `${Object.keys(runtimeConfigSchema).join(", ")}.`,
      };
    }

    const parsedValue = field.parse(rawValue);
    if (parsedValue === null) {
      return {
        ok: false,
        message: `Invalid value \"${rawValue}\" for ${configName}.`,
      };
    }

    const candidate = {
      ...runtimeConfig,
      [field.key]: parsedValue,
    };
    const validationError = field.validate(parsedValue, candidate);

    if (validationError) {
      return {
        ok: false,
        message: `Invalid ${configName}: ${validationError}.`,
      };
    }

    const previousValue = runtimeConfig[field.key];
    runtimeConfig[field.key] = parsedValue;

    if (field.key === "historyMessages") {
      onHistoryMessagesChanged(runtimeConfig.historyMessages);
    }

    return {
      ok: true,
      message: `Updated ${configName}: ${previousValue} -> ${parsedValue}`,
    };
  }

  return {
    runtimeConfig,
    setRuntimeConfigValue,
  };
}
