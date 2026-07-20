export const normalizeCommandWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const unquoteShellPayload = (payload: string): string => {
  const trimmed = payload.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  return trimmed;
};

export const unwrapShellCommand = (command: string): string => {
  const normalized = normalizeCommandWhitespace(command);
  const shellMatch = normalized.match(/^(?:\/bin\/)?(?:bash|sh)\s+-lc\s+(.+)$/);
  return shellMatch
    ? normalizeCommandWhitespace(unquoteShellPayload(shellMatch[1] ?? ""))
    : normalized;
};

export const shellLikeTokens = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && char === "\\" && index + 1 < command.length) {
        index += 1;
        current += command[index] ?? "";
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      current += command[index] ?? "";
      continue;
    }
    if ((char === "&" || char === "|") && command[index + 1] === char) {
      pushCurrent();
      tokens.push(`${char}${char}`);
      index += 1;
      continue;
    }
    if (char === "|" || char === ";") {
      pushCurrent();
      tokens.push(char);
      continue;
    }
    if (/\s/.test(char ?? "")) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();

  return tokens;
};

export const firstCommandSegment = (tokens: string[]): string[] => {
  const separatorIndex = tokens.findIndex(
    (token) =>
      token === "|" || token === "&&" || token === "||" || token === ";",
  );
  const segment =
    separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  return segment.filter((token) => !/^\d?>/.test(token));
};
