import { version } from "./data/brand.js";
import { mountApp } from "./components/app-shell.js";

document.title = `WhyJ Quant v${version} · 研究终端概念预览`;
mountApp(document.querySelector("#root"));
// Controllers bind only after every region has mounted.
await import("./session.js");
await import("./composer.mjs");
