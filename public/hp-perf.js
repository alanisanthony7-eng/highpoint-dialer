/* Highpoint Perf: pauses decorative animation while scrolling and while the tab is hidden. */
(() => {
  const root = document.documentElement; let t = 0;
  const on = () => { if (!root.classList.contains("hp-scrolling")) root.classList.add("hp-scrolling"); clearTimeout(t); t = setTimeout(() => root.classList.remove("hp-scrolling"), 160); };
  addEventListener("scroll", on, { passive: true, capture: true });
  addEventListener("wheel", on, { passive: true });
  addEventListener("touchmove", on, { passive: true });
  document.addEventListener("visibilitychange", () => root.classList.toggle("hp-hidden", document.hidden));
})();
