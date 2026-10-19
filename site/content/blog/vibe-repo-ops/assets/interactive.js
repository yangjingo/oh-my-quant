function blogIcon(name) { return document.querySelector('#blog-control-icons').content.querySelector(`[data-icon="${name}"]`).cloneNode(true); }
const flow = document.querySelector(".flow-demo");
const flowFigure = document.querySelector("#figure-4");
const staticFlow = flowFigure.querySelector(".figure-link");
flowFigure.insertBefore(flow, flowFigure.querySelector("figcaption"));
staticFlow.classList.add("flow-static");
const originalFlow = document.createElement("a");
originalFlow.href = staticFlow.href;
originalFlow.textContent = "查看静态 SVG";
flow.querySelector(".component-note").replaceChildren("示意流程，不代表当前 GitHub 检查状态。", originalFlow);
const steps = [
  { label: "Overview", nodes: [] },
  { label: "1 / 6 · Define scope", nodes: ["Issue"] },
  { label: "2 / 6 · Implement change", nodes: ["Feature branch"] },
  { label: "3 / 6 · Freeze candidate", nodes: ["PR candidate"] },
  { label: "4 / 6 · Independent checks", nodes: ["CI required", "PR policy", "Review"] },
  { label: "5 / 6 · Verify final revision", nodes: ["Pre-merge verification"] },
  { label: "6 / 6 · Merge and retain evidence", nodes: ["main"] },
];
let step = 0, timer;
const play = flow.querySelector("[data-play]");
const previous = flow.querySelector("[data-previous]");
const next = flow.querySelector("[data-next]");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function setPlayback(playing) { play.replaceChildren(blogIcon(playing ? 'pause' : 'play')); play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); play.title = playing ? 'Pause' : 'Play'; }
function pause() { clearInterval(timer); timer = undefined; setPlayback(false); }
function renderStep() {
  flow.querySelector("output").textContent = steps[step].label;
  flow.querySelectorAll("[data-node]").forEach(node => {
    const active = steps[step].nodes.includes(node.dataset.node);
    node.classList.toggle("flow-muted", step !== 0 && !active);
    node.classList.toggle("flow-active", active);
  });
  previous.disabled = step === 0;
  next.disabled = step === steps.length - 1;
}
previous.addEventListener("click", () => { pause(); step = Math.max(0, step - 1); renderStep(); });
next.addEventListener("click", () => { pause(); step = Math.min(steps.length - 1, step + 1); renderStep(); });
flow.querySelector("[data-overview]").addEventListener("click", () => { pause(); step = 0; renderStep(); });
play.addEventListener("click", () => {
  if (timer) return pause();
  if (step === steps.length - 1) step = 0;
  step++; renderStep();
  setPlayback(true);
  timer = setInterval(() => {
    step++; renderStep();
    if (step === steps.length - 1) pause();
  }, 1800);
});
function motionPreference() { pause(); play.hidden = reducedMotion.matches; }
reducedMotion.addEventListener("change", motionPreference);
new IntersectionObserver(entries => { if (!entries[0].isIntersecting) pause(); }).observe(flow);
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("beforeprint", () => { pause(); step = 0; renderStep(); });
flow.hidden = false;
motionPreference(); renderStep();

// The article currently contains one local body recording; references are links.
document.querySelectorAll("video").forEach(video => video.addEventListener("play", () => {
  document.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); });
}));
document.querySelectorAll("video").forEach(video => {
  const status = video.closest(".media-card").querySelector("[data-native-status]");
  const message = text => { status.hidden = false; status.textContent = text; };
  video.addEventListener("waiting", () => message("视频缓冲中；可下载视频或查看图 6。"));
  video.addEventListener("playing", () => { status.hidden = true; });
  const failed = () => message("视频无法加载或格式不受支持，请下载视频或查看图 6。");
  video.addEventListener("error", failed);
  video.querySelectorAll("source").forEach(source => source.addEventListener("error", failed));
  video.closest("details")?.addEventListener("toggle", event => { if (!event.target.open) video.pause(); });
});

// Printing retains the body video's description and source, never its player.
const bodyVideo = document.querySelector(".body-video");
let bodyVideoWasOpen = false;
window.addEventListener("beforeprint", () => { bodyVideoWasOpen = bodyVideo.open; bodyVideo.open = true; });
window.addEventListener("afterprint", () => { bodyVideo.open = bodyVideoWasOpen; });
