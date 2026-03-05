import { describe, expect, it } from "vitest";
import { Transcriber } from "./transcriber";

describe("Transcriber", () => {
  it("records words separated by spaces", () => {
    const t = new Transcriber();
    t.addWord("hello");
    t.addWord("world");
    expect(t.toString()).toBe("hello world");
  });

  it("records each blank as a separate [pause]", () => {
    const t = new Transcriber();
    t.addWord("hello");
    t.addWord("");
    t.addWord("");
    t.addWord("");
    t.addWord("world");
    expect(t.toString()).toBe("hello [pause] [pause] [pause] world");
  });

  it("records a single blank as [pause]", () => {
    const t = new Transcriber();
    t.addWord("hello");
    t.addWord("");
    t.addWord("world");
    expect(t.toString()).toBe("hello [pause] world");
  });

  it("records start and stop markers", () => {
    const t = new Transcriber();
    t.start();
    t.addWord("hello");
    t.stop();
    expect(t.toString()).toBe("[started] \n hello \n[stopped]");
  });

  it("inserts line breaks", () => {
    const t = new Transcriber();
    t.addWord("hello");
    t.lineBreak();
    t.addWord("world");
    expect(t.toString()).toBe("hello \n world");
  });

  it("resets the transcript", () => {
    const t = new Transcriber();
    t.addWord("hello");
    t.reset();
    expect(t.toString()).toBe("");
  });
});
