// Progressive enhancement: reading, links and the mobile contents work without JS.
document.documentElement.classList.add("js");
const article = document.querySelector("#article");
const sections = [...article.querySelectorAll("h2[id]")];
const headings = [...article.querySelectorAll("h2[id], h3[id]")];
const progress = document.querySelector("#reading-progress");
const printButton = document.querySelector("#print-article");
const shareButton = document.querySelector("#share-article");
const actionStatus = document.querySelector("#article-action-status");
const shareFallback = document.querySelector("#share-fallback");
progress.hidden = false;
printButton.hidden = false;
shareButton.hidden = false;
printButton.addEventListener("click", () => {
  actionStatus.textContent = "在打印窗口中选择打印，或选择“保存为 PDF”。";
  window.print();
});
shareButton.addEventListener("click", async () => {
  // A local review draft shares its real URL, not an unrelated production page.
  const url = document.querySelector('link[rel="canonical"]')?.href ?? location.href;
  const title = document.querySelector("h1").innerText.replace(/\s+/g, " ");
  shareFallback.hidden = true;
  actionStatus.textContent = "";
  shareButton.disabled = true;
  try {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        actionStatus.textContent = "已交给系统分享。";
        return;
      } catch (error) {
        if (error.name === "AbortError") { actionStatus.textContent = "已取消分享。"; return; }
        // Some desktop browsers expose sharing but cannot complete it.
      }
    }
    await navigator.clipboard.writeText(url);
    actionStatus.textContent = "链接已复制。";
  } catch {
    actionStatus.textContent = "无法自动复制，请复制下方链接地址。";
    shareFallback.href = url;
    shareFallback.hidden = false;
  } finally {
    shareButton.disabled = false;
  }
});
let scheduled = false;
let currentId = "";
const contentsSidebar = document.querySelector(".sidebar");
const contentsReveal = document.querySelector(".sidebar-reveal");
const contentsMotion = matchMedia("(prefers-reduced-motion: reduce)");
function refresh() {
  scheduled = false;
  const bodyTop = article.getBoundingClientRect().top;
  const reveal = contentsMotion.matches ? 1 : Math.min(1, Math.max(0, (innerHeight * .8 - bodyTop) / (innerHeight * .2)));
  contentsReveal.style.setProperty("--toc-reveal", reveal.toFixed(3));
  contentsSidebar.inert = reveal === 0;
  const start = article.offsetTop;
  const available = Math.max(1, article.offsetHeight - window.innerHeight + 100);
  progress.value = Math.min(100, Math.max(0, (window.scrollY - start + 100) / available * 100));
  const currentSection = sections.filter(h => h.getBoundingClientRect().top <= 180).at(-1) ?? sections[0];
  const currentHeading = headings.filter(h => h.getBoundingClientRect().top <= 180).at(-1) ?? currentSection;
  if (currentHeading.id === currentId) return;
  currentId = currentHeading.id;
  document.querySelectorAll(".toc > li").forEach((item, i) => {
    const active = sections[i] === currentSection;
    item.classList.toggle("is-active", active);
    const children = item.querySelector(".toc-children-wrap");
    children.inert = !active;
    children.setAttribute("aria-hidden", String(!active));
  });
  document.querySelectorAll(".toc a").forEach(link => {
    if (link.hash === `#${currentHeading.id}` || link.hash === `#${currentSection.id}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(refresh);
}
document.addEventListener("scroll", schedule, { passive: true });
window.addEventListener("resize", schedule);
contentsMotion.addEventListener("change", schedule);
new ResizeObserver(schedule).observe(document.querySelector(".article-header"));
document.fonts.ready.then(schedule);
document.querySelectorAll('.toc a[href^="#"]').forEach(link => {
  link.addEventListener("click", () => document.querySelector(link.hash)?.focus({ preventScroll: true }));
});
document.querySelectorAll('.mobile-contents a[href^="#"]').forEach(link => {
  link.addEventListener("click", () => {
    document.querySelector(".mobile-contents").open = false;
    // Native anchor navigation remains in charge of URL/history and scrolling.
    document.querySelector(link.hash)?.focus({ preventScroll: true });
  });
});
refresh();

const figureDialog = document.querySelector(".figure-dialog");
let figureOpener;
document.querySelectorAll("[data-figure]").forEach(link => {
  link.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    figureOpener = link;
    const source = link.querySelector("img");
    const enlarged = figureDialog.querySelector("img");
    enlarged.src = source.currentSrc || source.src;
    enlarged.alt = source.alt;
    figureDialog.querySelector("h2").textContent = link.getAttribute("aria-label");
    figureDialog.querySelector(".figure-dialog-caption").textContent = link.closest("figure").querySelector("figcaption").textContent;
    figureDialog.showModal();
    document.documentElement.classList.add("figure-open");
    figureDialog.querySelector(".figure-dialog-canvas").scrollTo(0, 0);
  });
});
document.querySelector("#close-figure").addEventListener("click", () => figureDialog.close());
figureDialog.addEventListener("click", event => {
  if (event.target === figureDialog) {
    const bounds = figureDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) figureDialog.close();
  }
});
figureDialog.addEventListener("close", () => {
  document.documentElement.classList.remove("figure-open");
  figureOpener?.focus({ preventScroll: true });
});
