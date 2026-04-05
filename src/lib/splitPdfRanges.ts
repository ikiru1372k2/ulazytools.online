import { z } from "zod";

const rangeTokenPattern = /^\d+(?:\s*-\s*\d+)?$/;

function hasValidRangeSyntax(value: string) {
  const segments = value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return false;
  }

  return segments.every((segment) => {
    if (!rangeTokenPattern.test(segment)) {
      return false;
    }

    const [startValue, endValue] = segment.split("-").map((part) => part.trim());
    const start = Number.parseInt(startValue, 10);
    const end = endValue ? Number.parseInt(endValue, 10) : start;

    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start > 0 &&
      end > 0 &&
      start <= end
    );
  });
}

export const splitPdfRangesSchema = z
  .string()
  .trim()
  .min(1, "Enter at least one page range.")
  .refine(hasValidRangeSyntax, {
    message: "Use page ranges like 1-3,5,8-10.",
  });
