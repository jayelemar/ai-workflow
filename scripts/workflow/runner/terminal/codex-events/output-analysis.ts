import { asRecord } from "../../types.ts";

export const codexAgentMessageTexts = (stdout: string): string[] => {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (item?.type === "agent_message" && typeof item.text === "string") messages.push(item.text);
  }
  return messages;
};

export const stdoutContainsJsonEvents = (stdout: string): boolean => {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};
