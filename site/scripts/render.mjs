import { readFile } from "node:fs/promises";
import { articlePath, loadArticle } from "./article.mjs";

const siteOrigin = "https://oh-my-quant.vercel.app";

export const routes = [
  { path: "/", locale: "zh", page: "home" },
  { path: "/en/", locale: "en", page: "home" },
  { path: "/blog/", locale: "zh", page: "blog" },
  { path: "/en/blog/", locale: "en", page: "blog" },
  { path: articlePath, locale: "zh", page: "article" },
];

export async function loadContent() {
  const [catalog, releaseData, download, layout, header, home, blog] = await Promise.all([
    readFile(new URL("../content/messages.json", import.meta.url), "utf8"),
    readFile(new URL("../content/downloads.json", import.meta.url), "utf8"),
    readFile(new URL("../templates/download.html", import.meta.url), "utf8"),
    ...["layout", "header", "home", "blog"].map((name) =>
      readFile(new URL(`../templates/${name}.html`, import.meta.url), "utf8"),
    ),
  ]);
  const messages = JSON.parse(catalog);
  const release = JSON.parse(releaseData);
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !Number.isSafeInteger(release.windows?.sizeBytes) || release.windows.sizeBytes <= 0) throw new Error("Invalid Desktop release metadata");
  const releaseRoot = "https://github.com/yangjingo/oh-my-quant/releases/";
  if (release.releaseUrl !== `${releaseRoot}tag/v${release.version}` || release.checksumsUrl !== `${releaseRoot}download/v${release.version}/SHA256SUMS.txt` || release.windows.url !== `${releaseRoot}download/v${release.version}/WhyJ-Quant-Setup-${release.version}-win-x64.exe`) throw new Error("Desktop assets must match the repository release");
  for (const [key, message] of Object.entries(messages)) {
    for (const locale of ["zh", "en"]) {
      if (typeof message[locale] !== "string" || !message[locale].trim())
        throw new Error(`Missing ${locale} translation: ${key}`);
    }
  }
  return { messages, release, download, layout, header, home, blog, article: await loadArticle() };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

export function renderPage(content, route) {
  const { locale, page } = route;
  if (page === "article") return content.article;
  const otherLocale = locale === "en" ? "zh" : "en";
  const values = Object.fromEntries(
    Object.entries(content.messages).map(([key, message]) => [key, message[locale]]),
  );
  Object.assign(values, {
    "download.version": content.release.version,
    "download.size": `${Math.round(content.release.windows.sizeBytes / 1_000_000)} MB`,
    "download.url": content.release.windows.url,
    "download.releaseUrl": content.release.releaseUrl,
    "download.checksumsUrl": content.release.checksumsUrl,
    "locale.lang": locale === "zh" ? "zh-CN" : "en",
    "locale.otherLang": otherLocale === "zh" ? "zh-CN" : "en",
    "route.home": routes.find((entry) => entry.locale === locale && entry.page === "home").path,
    "route.blog": routes.find((entry) => entry.locale === locale && entry.page === "blog").path,
    "route.alternate": routes.find((entry) => entry.locale === otherLocale && entry.page === page).path,
    "route.zh": new URL(routes.find((entry) => entry.locale === "zh" && entry.page === page).path, siteOrigin).href,
    "route.en": new URL(routes.find((entry) => entry.locale === "en" && entry.page === page).path, siteOrigin).href,
    "page.canonical": new URL(route.path, siteOrigin).href,
    "page.title": values[`${page}.title`],
    "page.description": values[`${page}.description`],
    "page.blogCurrent": page === "blog" ? "page" : "false",
  });
  const html = content.layout
    .replace("{{partial.header}}", () => content.header)
    .replace("{{partial.content}}", () => content[page])
    .replace("{{partial.download}}", () => content.download)
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
      if (typeof values[key] !== "string") throw new Error(`Unknown message: ${key}`);
      return escapeHtml(values[key]);
    });
  // Some line breaks are hidden on narrow screens; English still needs a word boundary.
  return locale === "en" ? html.replace(/<br\s*\/?>/g, "$& ") : html;
}

export function renderRuntimeMessages(content) {
  const messages = Object.fromEntries(["zh", "en"].map((locale) => [
    locale,
    Object.fromEntries(Object.entries(content.messages)
      .filter(([key]) => key.startsWith("runtime."))
      .map(([key, message]) => [key.slice("runtime.".length), message[locale]])),
  ]));
  return `export const messages = ${JSON.stringify(messages)};\n`;
}
