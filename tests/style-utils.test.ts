import { describe, expect, it } from "vitest";
import { parseShadow, formatShadow, parseGradient, formatGradient, parseTransform, formatTransform, parseTransition, parseImageUrl, splitTopLevel } from "@/lib/client/style-utils";
import { validateDeclaration } from "@/lib/styles/stylesheet";

describe("composite style values", () => {
  it("splits at the top level only", () => {
    expect(splitTopLevel("rgb(0, 0, 0) 0px 1px, inset 0 0 2px red", ",")).toEqual(["rgb(0, 0, 0) 0px 1px", "inset 0 0 2px red"]);
    expect(splitTopLevel("rgba(0, 0, 0, 0.1) 0px 1px 3px", " ")).toEqual(["rgba(0, 0, 0, 0.1)", "0px", "1px", "3px"]);
  });

  it("reads shadows in author and computed order", () => {
    expect(parseShadow("0 1px 3px 0 rgba(0,0,0,0.12)")).toEqual({ inset: false, x: "0", y: "1px", blur: "3px", spread: "0", color: "#0000001f" });
    expect(parseShadow("rgb(0, 0, 0) 0px 4px 12px 0px inset")).toMatchObject({ inset: true, x: "0px", y: "4px", blur: "12px", spread: "0px", color: "#000000" });
    expect(parseShadow("none")).toBeNull();
    expect(formatShadow({ inset: true, x: "0px", y: "2px", blur: "4px", spread: "0px", color: "#000" })).toBe("inset 0px 2px 4px 0px #000");
  });

  it("round-trips two-stop gradients and rejects complex ones", () => {
    const g = parseGradient("linear-gradient(90deg, #ffffff, rgb(0, 0, 0))");
    expect(g).toEqual({ angle: 90, from: "#ffffff", to: "#000000" });
    expect(formatGradient(g!)).toBe("linear-gradient(90deg, #ffffff, #000000)");
    expect(parseGradient("linear-gradient(to right, red, blue)")).toEqual({ angle: 90, from: "#ff0000", to: "#0000ff" });
    expect(parseGradient("linear-gradient(red, blue, green)")).toBeNull();
    expect(parseGradient("radial-gradient(red, blue)")).toBeNull();
  });

  it("handles transforms, transitions and image urls", () => {
    expect(parseTransform("translate(10px, -4px) scale(1.1) rotate(3deg)")).toEqual({ x: "10px", y: "-4px", scale: "1.1", rotate: "3deg" });
    expect(parseTransform("matrix(1, 0, 0, 1, 0, 0)")).toBeNull();
    expect(formatTransform({ x: "0px", y: "0px", scale: "1", rotate: "0deg" })).toBeNull();
    expect(formatTransform({ x: "0px", y: "8px", scale: "1", rotate: "0deg" })).toBe("translate(0px, 8px)");
    expect(parseTransition("all 200ms ease-out")).toEqual({ duration: "200ms", easing: "ease-out" });
    expect(parseTransition("0s ease")).toEqual({ duration: "0s", easing: "ease" });
    expect(parseImageUrl('url("/images/hero.png")')).toBe("/images/hero.png");
    expect(parseImageUrl("none")).toBeNull();
  });
});

describe("declaration safety", () => {
  it("allows same-origin image urls only", () => {
    expect(validateDeclaration("background-image", 'url("/hero.png")')).toBeNull();
    expect(validateDeclaration("background-image", "url(/a/b.webp)")).toBeNull();
    expect(validateDeclaration("background-image", 'url("https://evil.example/x.png")')).toMatch(/public folder/);
    expect(validateDeclaration("background-image", 'url("//evil.example/x.png")')).toMatch(/public folder/);
    expect(validateDeclaration("background-image", 'url("javascript:alert(1)")')).toMatch(/public folder/);
    expect(validateDeclaration("background-image", 'url("/ok.png"), url("http://x/y.png")')).toMatch(/public folder/);
  });

  it("accepts the expanded vocabulary and still blocks injection", () => {
    expect(validateDeclaration("box-shadow", "0 1px 3px 0 rgba(0,0,0,0.12)")).toBeNull();
    expect(validateDeclaration("transform", "translate(10px, 0px) rotate(3deg)")).toBeNull();
    expect(validateDeclaration("transition", "all 200ms cubic-bezier(0.22, 1, 0.36, 1)")).toBeNull();
    expect(validateDeclaration("grid-column", "span 2")).toBeNull();
    expect(validateDeclaration("position", "sticky")).toBeNull();
    expect(validateDeclaration("color", "red; } body { display: none")).toMatch(/aren.t allowed/);
    expect(validateDeclaration("behavior", "url(x.htc)")).toMatch(/isn't supported/);
  });
});
