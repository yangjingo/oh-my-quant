import assert from "node:assert/strict";
import {
  detect,
  replaceToken,
  remapRefs,
  serialize,
  score,
} from "../src/features/composer/editor.mjs";

for (const text of [
  "https://example.com/path",
  "user@example.com",
  "用户@例子.公司",
  "//server",
  "/a/b",
])
  assert.equal(detect(text, text.length), null, text);
assert.equal(detect("看看@报告", 6).query, "报告");
assert.equal(detect('结合 @"reports/研究 笔记', 18).trigger, "@");
assert.equal(detect("/配置", 3).query, "配置");
assert.equal(
  replaceToken("/config 后文", detect("/config 后文", 3), "/config").text,
  "/config  后文",
);
assert.equal(
  replaceToken("@原有正文", detect("@原有正文", 1), "@README.md").text,
  "@README.md 原有正文",
);
assert.equal(
  replaceToken("/help后文", detect("/help后文", 5), "/help").text,
  "/help 后文",
);
assert.equal(
  replaceToken("@reports/", detect("@reports/", 9), "@reports/", true).text,
  "@reports/",
);
const ref = {
  start: 2,
  end: 5,
  token: "@研究",
  id: "stable-1",
  canonical: "@[研究](quant-session:stable-1)",
};
assert.equal(detect("见 @研究", 5, [ref]), null);
assert.deepEqual(remapRefs("见 @研究", "请见 @研究", [ref]), [
  { ...ref, start: 3, end: 6 },
]);
assert.deepEqual(remapRefs("见 @研究", "见 @研改究", [ref]), []);
assert.deepEqual(remapRefs("见 @研究", "见 @研究 后文", [ref]), [ref]);
assert.equal(
  serialize("见 @研究", [ref]),
  "见 @[研究](quant-session:stable-1)",
);
assert.throws(() => serialize("见 @错误", [ref]));
assert.ok(score("config", "cnf") < Infinity);
assert.equal(score("config", "zz"), Infinity);
console.log(
  "Composer core: trigger boundaries, caret-tail preservation, reference mapping and serialization passed.",
);
