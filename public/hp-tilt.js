/* Highpoint 3D pointer: spotlight and tilt on glass surfaces (hp-3d.css).
   Skips touch screens, reduced-motion users, and anything inside the pipeline board
   so drag-and-drop is never disturbed. Pure progressive enhancement. */
(() => {
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!matchMedia("(pointer: fine)").matches) return;
    const SEL = ".panel, .hero, .kpis > div, .col, .rank-card, .tiles > *, .hph-card";
    const TILT = ".kpis > div, .tiles > *, .rank-card";
    let cur = null, raf = 0, pending = null;

    const paint = () => {
      raf = 0;
      if (!pending) return;
      const { el, x, y } = pending;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
      el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      if (el.matches(TILT)) {
        el.style.setProperty("--rx", ((0.5 - py) * 9).toFixed(2) + "deg");
        el.style.setProperty("--ry", ((px - 0.5) * 11).toFixed(2) + "deg");
      }
    };

    const reset = (el) => {
      el.classList.remove("hp3-hot");
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    };

    document.addEventListener("pointermove", (e) => {
      const t = e.target;
      let el = t && t.closest ? t.closest(SEL) : null;
      if (el === document.body || el === document.documentElement) el = null;
      const ok = el && !el.closest(".board");
      if (cur && cur !== (ok ? el : null)) reset(cur);
      cur = ok ? el : null;
      if (!cur) return;
      cur.classList.add("hp3-hot");
      pending = { el: cur, x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });

    document.addEventListener("pointerleave", () => { if (cur) { reset(cur); cur = null; } });
  } catch (err) {
    /* enhancement only: never break the desk */
  }
})();
