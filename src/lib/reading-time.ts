const CHARS_PER_MINUTE = 500;
const WORDS_PER_MINUTE = 220;

export function getReadingMinutes(text = "") {
  const compact = text.replace(/```[\s\S]*?```/g, " ").trim();
  const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinCount = compact
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  const cjkMinutes = cjkCount / CHARS_PER_MINUTE;
  const latinMinutes = latinCount / WORDS_PER_MINUTE;
  return Math.max(1, Math.ceil(cjkMinutes + latinMinutes));
}
