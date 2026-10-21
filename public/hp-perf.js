/* Highpoint Perf: pauses decorative animation while scrolling and while the tab is hidden. */
(() => {
  const root = document.documentElement; let t = 0;
  const on = () => { if (!root.classList.contains("hp-scrolling")) root.classList.add("hp-scrolling"); clearTimeout(t); t = setTimeout(() => root.classList.remove("hp-scrolling"), 160); };
  addEventListener("scroll", on, { passive: true, capture: true });
  addEventListener("wheel", on, { passive: true });
  addEventListener("touchmove", on, { passive: true });
  document.addEventListener("visibilitychange", () => root.classList.toggle("hp-hidden", document.hidden));
  // fast UI clocks and watchers (<= 5s) don't need to run in a background tab
  const si = window.setInterval;
  window.setInterval = function (f, ms, ...a) { return typeof f === "function" && ms > 0 && ms < 5000 ? si.call(window, function () { if (!document.hidden) return f.apply(this, arguments); }, ms, ...a) : si.call(window, f, ms, ...a); };
})();
