const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  M = require("../page-model.js"),
  C = require("../scan-core.js");
function page() {
  return {
    id: "page-two",
    image: "old JPEG",
    sourceImage: "original color",
    width: 600,
    height: 800,
    paper: [210, 297],
    text: "Reviewed amount: 450",
    fields: "Total: 450",
    type: "Invoice",
    words: [{ text: "450", bbox: { x0: 1, y0: 1, x1: 20, y1: 20 } }],
    ocrText: "Reviewed amount: 450",
    confidence: 91,
    editRecipe: { mode: "original" },
  };
}
test("saving an image edit preserves page identity and reviewed text but invalidates OCR geometry", () => {
  const before = page(),
    copy = structuredClone(before),
    edited = M.commit(before, {
      id: "wrong",
      image: "new JPEG",
      width: 800,
      height: 600,
    });
  assert.deepEqual(before, copy);
  assert.equal(edited.id, before.id);
  assert.equal(edited.text, before.text);
  assert.equal(edited.fields, before.fields);
  assert.deepEqual(edited.words, []);
  assert.equal(edited.ocrStale, true);
  assert.equal(edited.confidence, null);
  assert.deepEqual(C.textRuns(edited), []);
  assert.equal(edited.priorReview.text, before.text);
});
test("one-step undo restores source, image and recognition without recursive versions", () => {
  const original = page(),
    first = M.commit(original, { image: "first", width: 600, height: 800 }),
    second = M.commit(first, { image: "second", width: 600, height: 800 });
  assert.ok(!("undo" in second.undo));
  const undone = M.undo(second);
  assert.equal(undone.image, "first");
  assert.equal(undone.sourceImage, original.sourceImage);
  assert.equal(M.undo(undone), null);
  assert.deepEqual(M.undo(first), original);
});
test("new pages without recognition do not invent stale reviewed text", () => {
  const clean = {
      id: "new",
      image: "old",
      width: 600,
      height: 800,
      text: "",
      fields: "",
      words: [],
    },
    edited = M.commit(clean, { image: "new", width: 600, height: 800 });
  assert.equal(edited.ocrStale, false);
  assert.equal(edited.priorReview, undefined);
});
test("transaction snapshots omit pending OCR and keep the original review across repeated image edits", () => {
  const original = page();
  original.pendingText = "unaccepted recognition";
  const first = M.commit(original, { image: "first", width: 600, height: 800 }),
    second = M.commit(first, { image: "second", width: 600, height: 800 });
  assert.ok(!("pendingText" in second));
  assert.ok(!("pendingText" in second.undo));
  assert.equal(second.priorReview.text, original.text);
});
test("legacy pages use full saved-image bounds and preserve paper format", () => {
  const legacy = { paper: [279.4, 215.9] };
  const r = M.recipe(legacy, 900, 600);
  assert.equal(r.mode, "original");
  assert.equal(r.format, "LETTER");
  assert.deepEqual(r.corners[2], { x: 899, y: 599 });
  r.corners[0].x = 10;
  assert.equal(M.recipe(legacy, 900, 600).corners[0].x, 0);
});
test("invalid render results cannot replace an existing saved page", () => {
  assert.throws(() =>
    M.commit(page(), { image: "bad", width: NaN, height: 50 }),
  );
});
