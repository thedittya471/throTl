import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreGlobalSpace, shouldIgnoreGlobalKey } from "../lib/keyboard.js";

describe("Keyboard Shortcuts & Spacebar Isolation", () => {
  it("ignores global key handling when target is an input or editable field", () => {
    assert.equal(shouldIgnoreGlobalKey({ tagName: "INPUT" }), true);
    assert.equal(shouldIgnoreGlobalKey({ tagName: "SELECT" }), true);
    assert.equal(shouldIgnoreGlobalKey({ tagName: "TEXTAREA" }), true);
    assert.equal(shouldIgnoreGlobalKey({ isContentEditable: true }), true);
    assert.equal(shouldIgnoreGlobalKey({ tagName: "DIV" }), false);
  });

  it("preserves native spacebar activation for button and role=button targets", () => {
    // Focused HTML button
    assert.equal(shouldIgnoreGlobalSpace({ tagName: "BUTTON" }), true);

    // Child element inside button (e.g. icon or label)
    assert.equal(
      shouldIgnoreGlobalSpace({
        tagName: "SPAN",
        closest: (sel) => (sel === "button" ? {} : null),
      }),
      true
    );

    // Custom role=button element
    assert.equal(
      shouldIgnoreGlobalSpace({
        tagName: "DIV",
        getAttribute: (attr) => (attr === "role" ? "button" : null),
      }),
      true
    );

    // Regular page element allows spacebar simulator trigger
    assert.equal(
      shouldIgnoreGlobalSpace({
        tagName: "DIV",
        closest: () => null,
        getAttribute: () => null,
      }),
      false
    );
  });
});
