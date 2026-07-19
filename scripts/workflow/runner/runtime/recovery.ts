export const replacePlanSectionValue = (
  content: string,
  heading: string,
  value: string,
): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return content;
  }
  let valueIndex = -1;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("##")) {
      break;
    }
    if (trimmed.length > 0) {
      valueIndex = index;
      break;
    }
  }
  if (valueIndex === -1) {
    lines.splice(headingIndex + 1, 0, "", value);
  } else {
    lines[valueIndex] = value;
  }
  return lines.join("\n");
};
