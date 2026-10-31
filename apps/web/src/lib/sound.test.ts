import { describe, expect, it } from "vitest";
import { soundFor } from "@/lib/sound";

describe("move sounds", () => {
  it("picks the sound from the move's SAN", () => {
    expect(soundFor("e4")).toBe("move");
    expect(soundFor("O-O")).toBe("move");
    expect(soundFor("Nxe5")).toBe("capture");
    expect(soundFor("exd8=Q")).toBe("capture");
    expect(soundFor("Bb5+")).toBe("check");
    expect(soundFor("Qxf7#")).toBe("check");
  });
});
