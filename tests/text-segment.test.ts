import { describe, expect, it } from "vitest";
import { countOccurrences, locateSegment } from "@/lib/client/text-segment";

const slice = (s: string, seg: { start: number; end: number } | null) => (seg ? s.slice(seg.start, seg.end) : null);

describe("locateSegment", () => {
  it("finds the selected part inside markup", () => {
    const literal = "Flip through it like a *Photo Gallery*";
    expect(slice(literal, locateSegment(literal, "Photo Gallery", "Flip through it like a Photo Gallery", 0))).toBe("Photo Gallery");
  });

  it("edits the whole string when the element shows all of it", () => {
    expect(locateSegment("Try the app", "Try the app", "Try the app", 0)).toBeNull();
  });

  it("picks the clicked repeat of a word", () => {
    const literal = "Swipe to browse, double-tap to like, swipe up for details.";
    const context = literal;
    const second = locateSegment(literal, "to", context, 1)!;
    expect(literal.slice(0, second.start)).toBe("Swipe to browse, double-tap ");
    const first = locateSegment(literal, "to", context, 0)!;
    expect(first.start).toBe(6);
  });

  it("folds a screen-reader duplicate back onto the source", () => {
    const literal = "Swipe to browse, double-tap to like.";
    // Accessible text matched; the raw text before the clicked piece held the sentence once already.
    const seg = locateSegment(literal, "to", literal, 3)!;
    expect(literal.slice(0, seg.start)).toBe("Swipe to browse, double-tap ");
  });

  it("won't guess when a repeated word's position is unknown", () => {
    expect(locateSegment("to and to", "to", "to and to", null)).toBeNull();
  });

  it("matches whole words only", () => {
    expect(countOccurrences("Photo tomato to", "to")).toBe(1);
    expect(slice("one *restaurant* at a time", locateSegment("one *restaurant* at a time", "restaurant", "one restaurant at a time", 0))).toBe("restaurant");
  });
});
