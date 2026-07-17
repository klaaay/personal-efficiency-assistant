import assert from "node:assert/strict";
import {
  isValidTagColor,
  sanitizeTagColors,
  contrastTextColor,
} from "./tagColor.ts";

assert.equal(isValidTagColor("#aabbcc"), true);
assert.equal(isValidTagColor("#AABBCC"), true);
assert.equal(isValidTagColor("#fff"), false);
assert.equal(isValidTagColor("red"), false);

assert.deepEqual(sanitizeTagColors(undefined), {});
assert.deepEqual(sanitizeTagColors(null), {});
assert.deepEqual(sanitizeTagColors("x"), {});
assert.deepEqual(
  sanitizeTagColors({ a: "#112233", b: "nope", c: "#FFEEDD" }),
  { a: "#112233", c: "#ffeedd" }
);

assert.equal(contrastTextColor("#000000"), "#ffffff");
assert.equal(contrastTextColor("#ffffff"), "#1a1a1a");
assert.equal(contrastTextColor("#1a1a1a"), "#ffffff");
assert.equal(contrastTextColor("bad"), "#1a1a1a");

console.log("tagColor.verify: ok");
