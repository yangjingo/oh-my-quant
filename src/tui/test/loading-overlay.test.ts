import { Buffer } from "../src/buffer.ts";
import { drawLoadingOverlay, thinkingBannerStyle } from "../src/loading-overlay.ts";

describe("loading overlay", () => {
  it("renders spinner copy and quote text in the target region", () => {
    const buf = new Buffer(80, 20);
    drawLoadingOverlay(
      buf,
      { x: 0, y: 0, w: 80, h: 20 },
      "thinking",
      80,
      [{ quote: "Stay rational.", en: "Stay rational.", author: "Buffett" }],
      () => "thinking",
    );

    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("WhyJ is thinking");
    expect(plain).toContain("Stay rational.");
    expect(thinkingBannerStyle().fg).toMatch(/^#/);
  });
});
