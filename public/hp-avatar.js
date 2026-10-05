/* Highpoint characters: original, detailed cartoon avatars drawn as SVG (no outside services).
   window.hpAvatar.render(char, size, {crop}) -> SVG string
   window.hpAvatar.openCreator({char, handle, motto, onSave}) -> full-screen character creator */
(() => {
  "use strict";
  if (window.hpAvatar) return;
  const CX = 200;

  /* ---------------- color helpers ---------------- */
  const rgb = (h) => { let x = String(h || "#888888").replace("#", ""); if (x.length === 3) x = x.split("").map((ch) => ch + ch).join(""); const n = parseInt(x.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const hex = (a) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const sh = (h, k) => (k < 0 ? mix(h, "#000000", -k) : mix(h, "#FFFFFF", k));
  const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const okHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // mirror a left-side path to the right side (absolute M/L/C/Q pairs only)
  const mir = (d) => d.replace(/(-?\d*\.?\d+)[ ,]+(-?\d*\.?\d+)/g, (m, x, y) => `${+(2 * CX - +x).toFixed(1)} ${y}`);

  /* ---------------- palettes ---------------- */
  const PAL = {
    skin: ["#FFEBDD", "#FDE0CB", "#F9D3B7", "#F6C9A8", "#F1BC95", "#ECB089", "#E6A57C", "#DE9A6F", "#D49065", "#C9855A", "#BE7A50", "#B26E47", "#A5633F", "#985838", "#8A4E31", "#7D452B", "#703C25", "#633420", "#572D1C", "#4B2718", "#F3CFB3", "#E8BE9C", "#D8AE8A", "#C49A76", "#F5D5C0", "#E3B999", "#C68C6B", "#9E6A4F", "#7E5440", "#5E3E30"],
    hair: ["#120E0C", "#241914", "#36251B", "#4A3122", "#5E3D29", "#764B30", "#8F5A35", "#A86C3C", "#C2844A", "#D8A25E", "#E8C27E", "#F2DDB0", "#A33A26", "#C2552E", "#7E2A1E", "#BFC0C8", "#E6E7EC", "#FF4FA3", "#B15CFF", "#3D8BFF", "#2FC6D9", "#2FBF71", "#FF7A3D", "#FFD447"],
    eye: ["#3B2416", "#5A3720", "#7A5230", "#9A7440", "#4E7A3C", "#6E9A55", "#3E7CB1", "#6FA8DC", "#7A8A99", "#5C6670", "#2B2B2B", "#8A5A9E"],
    cloth: ["#FFFFFF", "#F2F2F5", "#F5E6C8", "#E9D5B5", "#FFD1EC", "#FF8CC6", "#FF4FA3", "#FF2E68", "#E5383B", "#FF7A3D", "#FF9E3D", "#FFD447", "#C8E66B", "#2FBF71", "#1E8F5A", "#3DF5FF", "#2FC6D9", "#3D8BFF", "#2E4FD8", "#16295A", "#B15CFF", "#6E3FA8", "#8C2F23", "#6B4A35", "#A8A9B3", "#5A5F6E", "#2B2D36", "#121318"],
    lip: ["#B5475A", "#C2185B", "#E5383B", "#FF4FA3", "#D4846F", "#A0522D", "#7E2A3E", "#5A1F2E", "#E9A0A0", "#B15CFF"],
    shadow: ["#B15CFF", "#FF4FA3", "#FF9E3D", "#FFD447", "#3DF5FF", "#2FBF71", "#8C6A54", "#5A5F6E", "#2B2D36", "#E9C25A"],
    frame: ["#121318", "#3A2A20", "#7A5230", "#C9A24A", "#C9CDD6", "#FF4FA3", "#3D8BFF", "#E5383B", "#FFFFFF", "#B15CFF"],
    bg: ["#FF4FA3", "#FF2E68", "#E5383B", "#FF7A3D", "#FF9E3D", "#FFD447", "#C8E66B", "#2FBF71", "#1E8F5A", "#2FC6D9", "#3D8BFF", "#2E4FD8", "#16295A", "#B15CFF", "#6E3FA8", "#8C2F23", "#6B4A35", "#A8A9B3", "#5A5F6E", "#2B2D36", "#121318", "#F5E6C8", "#FFFFFF"],
    lens: ["#1A1A24", "#4A3A30", "#7A5230", "#C9852E", "#FFD447", "#FF7A3D", "#FF4FA3", "#E5383B", "#B15CFF", "#3D8BFF", "#2FC6D9", "#2FBF71", "#3B5A3A", "#A8A9B3", "#BFE3FF"],
  };
  const METAL = { gold: ["#F5D77A", "#C9962E"], silver: ["#EEF0F4", "#9AA0AC"], rose: ["#F4C0B0", "#C47A66"], black: ["#4A4D57", "#121318"] };

  /* ---------------- options ---------------- */
  const OPT = {
    face: ["oval", "round", "square", "heart", "long", "diamond"],
    eyes: ["almond", "round", "wide", "hooded", "monolid", "upturned", "downturned", "sleepy"],
    lashes: ["none", "natural", "full"],
    brows: ["soft", "straight", "arched", "angled", "thick", "thin", "bushy", "rounded"],
    nose: ["button", "straight", "small", "wide", "roman", "broad"],
    mouth: ["smile", "softsmile", "grin", "laugh", "smirk", "neutral", "open", "serious"],
    hair: ["buzz", "crop", "fade", "sidepart", "slick", "quiff", "spiky", "curlytop", "waves", "afro", "twists", "locs", "braids", "manbun", "flow", "mohawk", "bald"],
    beard: ["none", "stubble", "mustache", "handlebar", "pencil", "goatee", "soulpatch", "circle", "chinstrap", "short", "full", "long"],
    liner: ["none", "thin", "wing"],
    mole: ["none", "cheek", "lip", "eye"],
    piercing: ["none", "nosestud", "nosering", "septum", "brow", "lip"],
    glasses: ["none", "rect", "round", "aviator", "browline", "sunglasses", "sport", "oversized", "rimless", "shutter"],
    hat: ["none", "cap", "backcap", "beanie", "bucket", "fedora", "cowboy", "visor", "headband", "beret", "headphones", "headset", "durag", "crown"],
    top: ["tee", "vneck", "tank", "polo", "buttondown", "hoodie", "sweater", "turtleneck", "graphic", "stripes", "jersey", "tropical", "flannel", "tiedye", "camo", "tracksuit", "moneytee"],
    outer: ["none", "blazer", "suit", "leather", "bomber", "denim", "varsity", "vest", "cardigan", "puffer", "furcoat"],
    neck: ["none", "tie", "bowtie", "chain", "cuban", "hppiece", "pendant", "bandana", "lanyard"],
    earrings: ["none", "studs", "hoops", "drops"],
    buds: ["none", "airpods", "earpods"],
    smoke: ["none", "joint", "cigar", "toothpick", "lollipop"],
    grill: ["none", "gold", "silver", "iced"],
    metal: ["gold", "silver", "rose", "black"],
    bg: ["solid"],
  };
  const LABEL = {
    oval: "Oval", round: "Round", square: "Square", heart: "Heart", long: "Long", diamond: "Diamond",
    almond: "Almond", wide: "Wide", hooded: "Hooded", monolid: "Monolid", upturned: "Upturned", downturned: "Downturned", sleepy: "Relaxed",
    none: "None", natural: "Natural", full: "Full",
    soft: "Soft", straight: "Straight", arched: "Arched", angled: "Angled", thick: "Thick", thin: "Thin", bushy: "Bushy", rounded: "Rounded",
    button: "Button", small: "Small", roman: "Roman", broad: "Broad",
    smile: "Smile", softsmile: "Soft smile", grin: "Grin", laugh: "Laugh", smirk: "Smirk", neutral: "Neutral", open: "Surprised", serious: "Serious",
    buzz: "Buzz cut", crop: "Crop", fade: "Fade", sidepart: "Side part", slick: "Slicked back", quiff: "Quiff", spiky: "Spiky", curlytop: "Curly top", waves: "Waves", afro: "Afro", puff: "Puff", twists: "Twists", locs: "Locs", braids: "Cornrows", bun: "Top bun", manbun: "Man bun", ponytail: "Ponytail", pixie: "Pixie", bob: "Bob", layered: "Layered", longwavy: "Long wavy", curlylong: "Long curls", mohawk: "Mohawk", bald: "Bald", flow: "Flow",
    stubble: "Stubble", mustache: "Mustache", handlebar: "Handlebar", pencil: "Pencil", goatee: "Goatee", soulpatch: "Soul patch", circle: "Circle beard", chinstrap: "Chin strap", short: "Short beard",
    thinl: "Thin", wing: "Wing", cheek: "Cheek", lip: "Lip", eye: "Under eye",
    nosestud: "Nose stud", nosering: "Nose ring", septum: "Septum", brow: "Brow",
    rect: "Classic", aviator: "Aviator", cateye: "Cat-eye", browline: "Browline", sunglasses: "Shades", sport: "Sport", oversized: "Oversized", rimless: "Rimless",
    cap: "Cap", backcap: "Backwards cap", beanie: "Beanie", bucket: "Bucket hat", fedora: "Fedora", cowboy: "Cowboy", visor: "Visor", headband: "Headband", beret: "Beret", headphones: "Headphones", headset: "Headset + mic", airpods: "Wireless earbuds", earpods: "Wired earbuds", joint: "Joint", cigar: "Cigar", toothpick: "Toothpick", lollipop: "Lollipop", iced: "Iced out", flannel: "Flannel", tiedye: "Tie-dye", camo: "Camo", tracksuit: "Track jacket", moneytee: "Money tee", puffer: "Puffer", furcoat: "Fur coat", cuban: "Cuban link", hppiece: "Highpoint piece", bandana: "Bandana", durag: "Durag", crown: "Crown", shutter: "Shutter shades",
    tee: "T-shirt", vneck: "V-neck", tank: "Tank top", polo: "Polo", buttondown: "Button-down", hoodie: "Hoodie", sweater: "Sweater", turtleneck: "Turtleneck", graphic: "Highpoint tee", stripes: "Stripes", jersey: "Jersey", blouse: "Blouse", tropical: "Tropical",
    blazer: "Blazer", suit: "Suit jacket", leather: "Leather", bomber: "Bomber", denim: "Denim", varsity: "Varsity", vest: "Puffer vest", cardigan: "Cardigan",
    tie: "Tie", bowtie: "Bow tie", chain: "Chain", pendant: "Pendant", pearls: "Pearls", lanyard: "Badge",
    studs: "Studs", hoops: "Hoops", drops: "Drops", gold: "Gold", silver: "Silver", rose: "Rose gold", black: "Black",
    sunset: "Sunset", neon: "Neon", ocean: "Ocean", city: "City night", palms: "Palms", office: "Office", mint: "Mint", lavender: "Lavender", slate: "Slate", pink: "Pink", solid: "Solid color",
  };
  const label = (k, v) => (k === "liner" && v === "thin" ? "Thin" : LABEL[v] || v);
  const TUNE = ["headW", "jaw", "chin", "ears", "neck", "build", "eyeSize", "eyeGap", "eyeY", "eyeTilt", "browY", "browW", "noseSize", "noseY", "mouthW", "mouthY", "lips"];
  const DEF = {
    v: 4, skin: "#E6A57C", face: "oval", hair: "sidepart", hairColor: "#36251B", beard: "none", beardColor: null,
    eyes: "almond", eyeColor: "#5A3720", lashes: "none", brows: "soft", browColor: null, nose: "button", mouth: "smile",
    lipColor: "#B5475A", lipA: 0, blush: 0.25, blushColor: "#FF6F9C", shadowColor: "#B15CFF", shadowA: 0, liner: "none",
    freckles: 0, mole: "none", piercing: "none", age: 0,
    glasses: "none", glassColor: "#121318", hat: "none", hatColor: "#16295A",
    top: "tee", topColor: "#FFFFFF", top2: "#FF4FA3", outer: "none", outerColor: "#2B2D36", neck: "none", earrings: "none", buds: "none", smoke: "none", grill: "none", metal: "gold",
    bg: "solid", bgColor: "#FF4FA3", lensColor: null, tune: {},
  };

  /* ---------------- migrate older characters ---------------- */
  const V2 = {
    skin: ["#FFE7D6", "#FDDCC4", "#F9D0B2", "#F5C6A5", "#F0BA94", "#EAAE86", "#E4A27A", "#DC9A6E", "#D48E63", "#C98459", "#BD784E", "#B06C45", "#A3623D", "#955736", "#874D2F", "#7A4429", "#6D3B23", "#61331E", "#552C1A", "#4A2617", "#F2C4A0", "#E0B48F", "#C9A27E", "#B38E6D"],
    hair: ["#14100E", "#2B1D16", "#3D2A1E", "#55392A", "#6E4A33", "#8A5A3B", "#A8703F", "#C48A4A", "#D9A65C", "#E8C27A", "#F2DCA6", "#B5462F", "#8C2F23", "#C9C9D1", "#F2F2F5", "#FF4FA3", "#3DF5FF", "#B15CFF", "#2E6BFF", "#2FBF71"],
    eye: ["#3B2416", "#6B4226", "#8A6A3B", "#4E7A3C", "#3E7CB1", "#6FA8DC", "#7A7F87", "#2B2B2B"],
    cloth: ["#FFFFFF", "#F5E6C8", "#FFD1EC", "#FF4FA3", "#FF2E88", "#FF9E3D", "#FFE45E", "#2FBF71", "#3DF5FF", "#2E6BFF", "#16295A", "#B15CFF", "#7A4AA0", "#8C2F23", "#1B1B26", "#5A5F6E"],
    v1skin: ["#FBE0CC", "#F2C9A6", "#E2A97E", "#C98B5E", "#A86B43", "#8A5232", "#6B3C22", "#4A2A18"],
    v1hair: ["#1A1210", "#3B2416", "#6B4226", "#A0662E", "#D9A441", "#E9D9B0", "#B9B9C2", "#FF4FA3", "#3DF5FF", "#B15CFF"],
    v1cloth: ["#FF2E88", "#3DF5FF", "#FF9E3D", "#B15CFF", "#FFFFFF", "#F5E6C8", "#1B1B26", "#2E6BFF", "#2FBF71", "#FFE45E"],
  };
  const BGMAP = { sunset: "#FF4FA3", neon: "#6E3FA8", ocean: "#3D8BFF", city: "#16295A", palms: "#FF7A3D", office: "#A8A9B3", gold: "#FFD447", mint: "#2FBF71", lavender: "#B15CFF", slate: "#2B2D36", pink: "#FF4FA3" };
  const HAIRMAP = { bun: "manbun", ponytail: "manbun", pixie: "crop", bob: "sidepart", layered: "flow", long: "flow", longwavy: "flow", curlylong: "afro", puff: "curlytop" };
  function migrate(c0) {
    const c = c0 && typeof c0 === "object" ? c0 : null;
    if (!c) return { ...DEF, tune: {} };
    if (c.v === 4) {
      const o = { ...DEF, ...c, tune: { ...(c.tune || {}) } };
      for (const k of Object.keys(o.tune)) if (typeof o.tune[k] !== "number" || !isFinite(o.tune[k])) delete o.tune[k];
      if (o.bg !== "solid") { o.bgColor = BGMAP[o.bg] || o.bgColor || "#FF4FA3"; o.bg = "solid"; }
      if (HAIRMAP[o.hair]) o.hair = HAIRMAP[o.hair];
      o.lipA = 0; o.shadowA = 0; o.liner = "none"; o.lashes = "none"; o.blush = 0.1; o.blushColor = null;
      for (const k of Object.keys(OPT)) if (k in o && !OPT[k].includes(o[k])) o[k] = DEF[k];
      return o;
    }
    const pick = (arr, i, d) => (Number.isInteger(i) && arr[i]) || d;
    const o = { ...DEF, tune: {} };
    if (c.v === 2) {
      o.skin = c.skinHex || pick(V2.skin, c.skin, DEF.skin);
      o.face = OPT.face.includes(c.face) ? c.face : "oval";
      o.hair = OPT.hair.includes(c.hair) ? c.hair : "crop";
      o.hairColor = c.hairHex || pick(V2.hair, c.hairColor, DEF.hairColor);
      o.beard = { none: "none", stubble: "stubble", mustache: "mustache", handlebar: "handlebar", goatee: "goatee", soulpatch: "soulpatch", chinstrap: "chinstrap", circle: "circle", short: "short", full: "full" }[c.beard] || "none";
      o.beardColor = c.beardHex || pick(V2.hair, c.beardColor, null);
      o.eyes = { round: "round", almond: "almond", sleepy: "sleepy", wide: "wide" }[c.eyes] || "almond";
      o.eyeColor = c.eyeHex || pick(V2.eye, c.eyeColor, DEF.eyeColor);
      o.brows = { straight: "straight", arched: "arched", thick: "thick", thin: "thin", angled: "angled" }[c.brows] || "soft";
      o.nose = { button: "button", straight: "straight", wide: "wide", pointed: "roman" }[c.nose] || "button";
      o.mouth = { smile: "smile", grin: "grin", smirk: "smirk", neutral: "neutral", laugh: "laugh" }[c.mouth] || "smile";
      o.glasses = { none: "none", aviators: "aviator", wayfarers: "sunglasses", round: "round", cateye: "cateye", clear: "rect", visor: "sport" }[c.glasses] || "none";
      o.hat = { none: "none", cap: "cap", backcap: "backcap", beanie: "beanie", bucket: "bucket", panama: "fedora", headband: "headband" }[c.hat] || "none";
      o.hatColor = c.hatHex || pick(V2.cloth, c.hatColor, DEF.hatColor);
      o.top = OPT.top.includes(c.top) ? c.top : "tee";
      o.topColor = c.topHex || pick(V2.cloth, c.topColor, DEF.topColor);
      o.outer = OPT.outer.includes(c.outer) ? c.outer : "none";
      o.outerColor = c.outerHex || pick(V2.cloth, c.outerColor, DEF.outerColor);
      o.neck = c.acc === "chain" || c.acc === "both" ? "chain" : "none";
      o.earrings = c.acc === "earrings" || c.acc === "both" ? "hoops" : "none";
      o.bg = { sunset: "sunset", neon: "neon", marina: "ocean", skyline: "city", palms: "palms", purple: "lavender", pink: "pink", mint: "mint", navy: "slate", custom: "solid" }[c.bg] || "sunset";
      if (c.bg === "custom" && okHex(c.bgHex2)) o.bgColor = c.bgHex2;
      for (const k of ["eyeY", "eyeTilt", "browY", "noseY", "mouthY"]) if (typeof c[k] === "number") o.tune[k] = c[k];
      o.v = 4;
      if (typeof c.faceW === "number") o.tune.headW = c.faceW;
      if (typeof c.jawW === "number") o.tune.jaw = c.jawW;
      if (typeof c.build === "number") o.tune.build = c.build;
      return migrate(o);
    }
    // first-generation characters
    o.skin = pick(V2.v1skin, c.skin, DEF.skin);
    o.hair = { short: "crop", slick: "slick", buzz: "buzz", curly: "curlytop", waves: "waves", afro: "afro", long: "long", bob: "bob", ponytail: "ponytail", braids: "braids", mohawk: "mohawk", bald: "bald" }[c.hair] || "crop";
    o.hairColor = pick(V2.v1hair, c.hairColor, DEF.hairColor);
    o.beard = { stubble: "stubble", mustache: "mustache", goatee: "goatee", beard: "full" }[c.face] || "none";
    o.glasses = { aviators: "aviator", wayfarers: "sunglasses", round: "round", visor: "sport" }[c.shades] || "none";
    o.hat = { cap: "cap", backcap: "backcap", panama: "fedora", headband: "headband" }[c.hat] || "none";
    const t = { tropical: ["tropical", "none"], suit: ["buttondown", "suit"], leather: ["tee", "leather"], polo: ["polo", "none"], blazer: ["buttondown", "blazer"], hoodie: ["hoodie", "none"], blouse: ["blouse", "none"], bomber: ["tee", "bomber"] }[c.top] || ["tee", "none"];
    const col = pick(V2.v1cloth, c.topColor, "#FF2E88");
    o.top = t[0]; o.outer = t[1];
    if (t[1] === "none") o.topColor = col; else o.outerColor = col;
    o.mouth = { smile: "smile", grin: "grin", smirk: "smirk", neutral: "neutral" }[c.mouth] || "smile";
    o.neck = c.acc === "chain" || c.acc === "both" ? "chain" : "none";
    o.earrings = c.acc === "earrings" || c.acc === "both" ? "hoops" : "none";
    o.bg = { sunset: "sunset", neon: "neon", marina: "ocean", skyline: "city", palms: "palms", purple: "lavender" }[c.bg] || "sunset";
    o.v = 4;
    return migrate(o);
  }

  function random() {
    const r = (a) => a[(Math.random() * a.length) | 0], p = (x) => Math.random() < x;
    const hc = p(0.85) ? r(PAL.hair.slice(0, 16)) : r(PAL.hair);
    const fem = false;
    const hair = r(OPT.hair);
    const tune = {}; for (const k of TUNE) if (p(0.35)) tune[k] = +(Math.random() * 1.2 - 0.6).toFixed(2);
    return {
      ...DEF, skin: r(PAL.skin), face: r(OPT.face), hair, hairColor: hc, beard: !fem && p(0.45) ? r(OPT.beard.slice(1)) : "none", beardColor: null,
      eyes: r(OPT.eyes), eyeColor: r(PAL.eye), lashes: fem ? r(["natural", "full"]) : "none", brows: r(OPT.brows), nose: r(OPT.nose), mouth: r(["smile", "smile", "softsmile", "grin", "grin", "laugh", "smirk", "neutral"]),
      lipA: fem && p(0.6) ? 0.55 : 0, lipColor: r(PAL.lip), blush: +(Math.random() * 0.5).toFixed(2), shadowA: fem && p(0.35) ? 0.45 : 0, shadowColor: r(PAL.shadow), liner: fem && p(0.4) ? r(["thin", "wing"]) : "none",
      freckles: p(0.15) ? 0.6 : 0, mole: p(0.1) ? r(OPT.mole.slice(1)) : "none", piercing: p(0.12) ? r(OPT.piercing.slice(1)) : "none",
      glasses: p(0.35) ? r(OPT.glasses.slice(1)) : "none", glassColor: r(PAL.frame), hat: p(0.2) ? r(OPT.hat.slice(1)) : "none", hatColor: r(PAL.cloth),
      top: r(OPT.top), topColor: r(PAL.cloth), top2: r(PAL.cloth), outer: p(0.45) ? r(OPT.outer.slice(1)) : "none", outerColor: r(PAL.cloth),
      neck: p(0.3) ? r(OPT.neck.slice(1)) : "none", earrings: fem && p(0.6) ? r(OPT.earrings.slice(1)) : p(0.1) ? "studs" : "none", metal: r(OPT.metal.slice(0, 3)),
      bg: "solid", bgColor: r(PAL.bg), lensColor: null, tune,
    };
  }

  /* ---------------- geometry ---------------- */
  const FACE = { oval: [92, 66, 302, 30], round: [98, 78, 298, 40], square: [95, 86, 299, 48], heart: [97, 58, 304, 22], long: [86, 66, 316, 32], diamond: [90, 60, 306, 24] };
  // men's head: full cheeks, a defined jaw angle and a rounded, squared-off chin
  function facePath(hw, jw, chinY, cw, top = 72) {
    const jy = top + 196, R = (x) => CX + x, L = (x) => CX - x;
    const right = `C${R(hw * 0.62)} ${top} ${R(hw)} ${top + 38} ${R(hw)} ${top + 92} C${R(hw)} ${top + 132} ${R(hw * 0.97)} ${top + 160} ${R(jw + (hw - jw) * 0.35)} ${jy - 14} C${R(jw + (hw - jw) * 0.12)} ${jy - 2} ${R(jw)} ${jy + 4} ${R(jw * 0.9)} ${jy + 14} C${R(jw * 0.72)} ${chinY - 12} ${R(cw + 10)} ${chinY - 1} ${R(cw * 0.55)} ${chinY} C${R(cw * 0.25)} ${chinY + 0.6} ${R(0)} ${chinY + 0.8} ${CX} ${chinY + 0.8}`;
    const left = `C${L(cw * 0.25)} ${chinY + 0.6} ${L(cw * 0.55)} ${chinY} ${L(cw * 0.55)} ${chinY} C${L(cw + 10)} ${chinY - 1} ${L(jw * 0.72)} ${chinY - 12} ${L(jw * 0.9)} ${jy + 14} C${L(jw)} ${jy + 4} ${L(jw + (hw - jw) * 0.12)} ${jy - 2} ${L(jw + (hw - jw) * 0.35)} ${jy - 14} C${L(hw * 0.97)} ${top + 160} ${L(hw)} ${top + 132} ${L(hw)} ${top + 92} C${L(hw)} ${top + 38} ${L(hw * 0.62)} ${top} ${CX} ${top}`;
    return `M${CX} ${top} ${right} ${left}Z`;
  }
  function geom(c) {
    const t = c.tune || {}, T = (k) => Math.max(-1, Math.min(1, +t[k] || 0));
    const [bhw, bjw, bchin, bcw] = FACE[c.face] || FACE.oval;
    const hw = bhw * (1 + 0.07 * T("headW")), jw = bjw * (1 + 0.12 * T("jaw")) * (1 + 0.07 * T("headW")), chinY = bchin + 12 * T("chin"), cw = bcw * (1 + 0.25 * T("jaw"));
    const eyeY = 200 + 7 * T("eyeY"), gap = 40 + 6 * T("eyeGap"), es = 1.08 + 0.17 * T("eyeSize");
    return {
      T, hw, jw, chinY, cw, eyeY, gap, es, tilt: 7 * T("eyeTilt"),
      browY: eyeY - 31 - 6 * T("browY"), browW: 1 + 0.5 * T("browW"),
      noseY: 247 + 6 * T("noseY") + (chinY - 302) * 0.25, ns: 1 + 0.22 * T("noseSize"),
      mouthY: 276 + 6 * T("mouthY") + (chinY - 302) * 0.45, mw: 1 + 0.2 * T("mouthW"), lips: 1 + 0.35 * T("lips"),
      ears: 1 + 0.25 * T("ears"), nw: 34 * (1 + 0.25 * T("neck")), SW: 158 * (1 + 0.14 * T("build")),
      sx: hw / 92,
    };
  }

  /* ---------------- the renderer ---------------- */
  let uid = 0;
  const CROPS = { bust: "24 0 352 440", head: "52 22 296 296", face: "118 146 164 164", eyes: "124 148 152 152", mouth: "138 222 124 124", beard: "104 172 192 192", body: "40 236 320 320", hat: "40 -10 320 320", close: "36 12 328 328", full: "0 0 400 500" };

  const bitmojiUrl = (c) => (c && typeof c.bitmoji === "string" && /^https:\/\/[^\s"'<>]+$/.test(c.bitmoji) ? c.bitmoji : "");
  function render(c0, size = 200, opts = {}) {
    const bm = bitmojiUrl(c0);
    if (bm) {
      const crop = opts.crop || (size <= 72 ? "head" : "bust"), vb = (CROPS[crop] || CROPS.bust).split(" ").map(Number);
      const h = opts.slice ? size : Math.round((size * vb[3]) / vb[2]);
      return `<img src="${esc(bm)}" width="${size}" height="${h}" alt="${esc(opts.label || "Bitmoji")}" loading="lazy" referrerpolicy="no-referrer" style="display:block;object-fit:${crop === "bust" ? "contain" : "cover"};object-position:50% 18%;background:radial-gradient(80% 80% at 50% 35%,#3a2a5a,#160d26)">`;
    }
    const c = migrate(c0);
    const G = geom(c);
    const u = "hpa" + ++uid;
    const crop = opts.crop || (size <= 72 ? "head" : "bust");
    const vb = CROPS[crop] || CROPS.bust;
    const [, , vw, vh] = vb.split(" ").map(Number);
    const W = size, Hh = opts.slice ? size : Math.round((size * vh) / vw);

    // colors
    const sk = okHex(c.skin) ? c.skin : DEF.skin, skL = mix(sk, "#FFF4EC", 0.32), skD = mix(sk, "#7A3B2C", 0.2), skDD = mix(sk, "#4E2219", 0.42), skLine = mix(sk, "#3A1A12", 0.55);
    const hc = okHex(c.hairColor) ? c.hairColor : DEF.hairColor, hcL = sh(hc, lum(hc) > 0.6 ? 0.25 : 0.32), hcD = sh(hc, -0.32), hcLine = sh(hc, -0.5);
    const bc = okHex(c.beardColor) ? c.beardColor : hc;
    const brc = okHex(c.browColor) ? c.browColor : lum(hc) > 0.72 ? sh(hc, -0.35) : sh(hc, -0.12);
    const tc = okHex(c.topColor) ? c.topColor : "#FFFFFF", t2 = okHex(c.top2) ? c.top2 : "#FF4FA3", oc = okHex(c.outerColor) ? c.outerColor : "#2B2D36";
    const htc = okHex(c.hatColor) ? c.hatColor : "#16295A";
    const met = METAL[c.metal] || METAL.gold;
    const natLip = mix(sh(sk, -0.22), "#C0606E", 0.38);
    const lip = c.lipA > 0 ? mix(natLip, okHex(c.lipColor) ? c.lipColor : "#B5475A", Math.min(1, c.lipA)) : natLip;
    const lipD = sh(lip, -0.35);

    const { hw, jw, chinY, cw, eyeY, gap, es, nw, SW, sx } = G;
    const FP = facePath(hw, jw, chinY, cw);
    const hasHat = c.hat !== "none" && c.hat !== "headphones" && c.hat !== "headband" && c.hat !== "headset";
    const hatClip = { cap: 114, backcap: 104, beanie: 118, bucket: 122, fedora: 112, cowboy: 108, visor: 0, beret: 104, durag: 112 }[c.hat] || 0;

    /* ---- defs ---- */
    const BG = {
      sunset: ["#2A0845", "#C2185B", "#FF9E3D"], neon: ["#0E0420", "#3A0F5E", "#0D3B5E"], ocean: ["#9BE7FF", "#3D8BFF", "#16295A"], city: ["#05030F", "#140A2E", "#2A0845"],
      palms: ["#FFB36B", "#FF4F7A", "#5A0F6E"], office: ["#E9EEF5", "#CBD5E3", "#9AA9BF"], gold: ["#FFF1C4", "#F5C451", "#C9852E"], mint: ["#E6FFF8", "#9EF0D8", "#3DBFA6"],
      lavender: ["#F1E6FF", "#C9A6FF", "#8C5AE0"], slate: ["#5A6478", "#2E3442", "#151821"], pink: ["#FFE3F1", "#FF9CCB", "#FF4FA3"],
    }[c.bg] || (c.bg === "solid" ? [sh(c.bgColor || "#FF4FA3", 0.25), c.bgColor || "#FF4FA3", sh(c.bgColor || "#FF4FA3", -0.2)] : ["#2A0845", "#C2185B", "#FF9E3D"]);
    let defs = `<defs>
<linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG[0]}"/><stop offset=".62" stop-color="${BG[1]}"/><stop offset="1" stop-color="${BG[2]}"/></linearGradient>
<radialGradient id="${u}sk" cx=".42" cy=".38" r=".72"><stop offset="0" stop-color="${skL}"/><stop offset=".6" stop-color="${sk}"/><stop offset="1" stop-color="${skD}"/></radialGradient>
<linearGradient id="${u}side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${skDD}" stop-opacity=".0"/><stop offset=".62" stop-color="${skDD}" stop-opacity="0"/><stop offset="1" stop-color="${skDD}" stop-opacity=".38"/></linearGradient>
<linearGradient id="${u}nk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skDD}"/><stop offset=".55" stop-color="${skD}"/><stop offset="1" stop-color="${sk}"/></linearGradient>
<linearGradient id="${u}hr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hcL}"/><stop offset=".45" stop-color="${hc}"/><stop offset="1" stop-color="${hcD}"/></linearGradient>
<linearGradient id="${u}hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hcD}"/><stop offset="1" stop-color="${sh(hc, -0.45)}"/></linearGradient>
<linearGradient id="${u}tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(tc, 0.12)}"/><stop offset="1" stop-color="${sh(tc, -0.16)}"/></linearGradient>
<linearGradient id="${u}ot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(oc, 0.14)}"/><stop offset="1" stop-color="${sh(oc, -0.18)}"/></linearGradient>
<linearGradient id="${u}ht" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(htc, 0.18)}"/><stop offset="1" stop-color="${sh(htc, -0.18)}"/></linearGradient>
<linearGradient id="${u}mt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${met[0]}"/><stop offset="1" stop-color="${met[1]}"/></linearGradient>
<radialGradient id="${u}bl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${mix(sk, "#C24A44", 0.55)}" stop-opacity=".8"/><stop offset="1" stop-color="${mix(sk, "#C24A44", 0.55)}" stop-opacity="0"/></radialGradient>
<clipPath id="${u}fc"><path d="${FP}"/></clipPath>
<clipPath id="${u}card"><rect width="400" height="560" rx="${opts.square ? 0 : 0}"/></clipPath>
${hatClip ? `<clipPath id="${u}hc"><rect x="-50" y="${hatClip}" width="500" height="700"/></clipPath>` : ""}
<pattern id="${u}dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="${sh(bc, -0.2)}"/><circle cx="4.5" cy="4.5" r=".9" fill="${sh(bc, -0.2)}"/></pattern>
<pattern id="${u}hdots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".9" fill="${hcD}"/><circle cx="3.7" cy="3.7" r=".8" fill="${hcD}"/></pattern>
</defs>`;

    /* ---- background ---- */
    const deco = {
      sunset: `<circle cx="200" cy="400" r="120" fill="#FFB347" opacity=".55"/><g fill="${BG[1]}" opacity=".45"><rect y="392" width="400" height="7"/><rect y="410" width="400" height="10"/><rect y="432" width="400" height="13"/></g>`,
      neon: `<g fill="none" stroke-width="4" opacity=".55"><rect x="26" y="40" width="92" height="34" rx="17" stroke="#FF4FA3"/><path d="M318 34 l7 16 l17 2 l-13 11 l4 17 l-15 -9 l-15 9 l4 -17 l-13 -11 l17 -2z" stroke="#3DF5FF"/><path d="M40 300 h70" stroke="#B15CFF"/></g>`,
      ocean: `<g fill="#fff" opacity=".5"><ellipse cx="80" cy="70" rx="44" ry="12"/><ellipse cx="330" cy="110" rx="36" ry="10"/></g><path d="M0 420 Q50 405 100 420 T200 420 T300 420 T400 420 V560 H0Z" fill="#16295A" opacity=".35"/>`,
      city: `<g fill="#0B0618">${[[0, 230, 50], [46, 190, 44], [86, 260, 50], [300, 210, 46], [342, 170, 58]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${560 - y}"/>`).join("")}</g><g fill="#FFC86B" opacity=".75">${Array.from({ length: 26 }, (_, i) => `<rect x="${[8, 20, 34, 54, 66, 78, 96, 112, 308, 322, 350, 366, 384][i % 13]}" y="${200 + ((i * 37) % 260)}" width="5" height="6"/>`).join("")}</g><circle cx="320" cy="70" r="26" fill="#FFF1C4" opacity=".85"/>`,
      palms: `<g fill="#2A0845" opacity=".75"><path d="M52 560 C56 470 64 410 78 360 l8 2 C74 410 68 470 68 560Z"/><path d="M78 360 c-26 -18 -56 -16 -76 0 c22 -12 50 -12 76 0z M82 360 c12 -26 40 -42 66 -38 c-24 8 -46 20 -66 38z M80 362 c-10 -24 -32 -40 -56 -42 c22 8 40 22 56 42z"/><path d="M348 560 C344 474 338 420 324 376 l-8 2 C328 420 332 474 332 560Z"/><path d="M322 376 c26 -18 56 -16 76 0 c-22 -12 -50 -12 -76 0z M318 376 c-12 -26 -40 -42 -66 -38 c24 8 46 20 66 38z"/></g>`,
      office: `<g opacity=".55"><rect x="24" y="40" width="110" height="150" rx="6" fill="#fff"/><path d="M79 40 V190 M24 115 H134" stroke="#CBD5E3" stroke-width="4"/><rect x="290" y="70" width="80" height="60" rx="6" fill="#fff"/><path d="M302 116 l16 -16 l12 10 l22 -24" stroke="#FF4FA3" stroke-width="4" fill="none" stroke-linecap="round"/></g><rect y="440" width="400" height="120" fill="#9AA9BF" opacity=".5"/>`,
      gold: `<g fill="#fff" opacity=".5">${[[60, 80, 6], [340, 60, 8], [320, 200, 5], [70, 260, 7], [200, 40, 4]].map(([x, y, r]) => `<path d="M${x} ${y - r * 2} L${x + r * 0.6} ${y - r * 0.6} L${x + r * 2} ${y} L${x + r * 0.6} ${y + r * 0.6} L${x} ${y + r * 2} L${x - r * 0.6} ${y + r * 0.6} L${x - r * 2} ${y} L${x - r * 0.6} ${y - r * 0.6}Z"/>`).join("")}</g>`,
    }[c.bg] || "";
    const bgArt = opts.noBg ? "" : `<rect x="-60" y="-60" width="520" height="680" fill="url(#${u}bg)"/><g filter="url(#${u}b2)">${deco}</g>`;

    /* ---- hair ---- */
    const HT = `translate(${CX} 0) scale(${sx.toFixed(3)} 1) translate(${-CX} 0)`;
    const hairFill = `url(#${u}hr)`, hairBack = `url(#${u}hb)`;
    const LOGO = (x, y, w, fill, accent = "#9CC3F0") => `<g transform="translate(${(x - w / 2).toFixed(1)} ${y}) scale(${(w / 132).toFixed(4)})" aria-label="Highpoint Financial"><text x="18" y="66" font-family="Libre Caslon Text, Georgia, 'Times New Roman', serif" font-size="70" fill="${fill}">H</text><text x="58" y="86" font-family="Libre Caslon Text, Georgia, 'Times New Roman', serif" font-size="70" fill="${fill}">P</text><path d="M4 80 C40 74 78 56 112 22 C82 58 44 78 4 80Z" fill="${fill}"/><path d="M104 22 L128 12 L118 30 L113 24 Z" fill="${fill}"/><path d="M113 24 L118 30 L112 31Z" fill="${accent}"/></g>`;
    const ink = (bgc, want) => (Math.abs(lum(want) - lum(bgc)) > 0.28 ? want : lum(bgc) > 0.55 ? "#16161E" : "#FFFFFF");
    const hp = (d, f = hairFill, extra = "") => `<path d="${d}" fill="${f}" ${extra}/>`;
    const shine = (d, w = 4, o = 0.45) => `<path d="${d}" fill="none" stroke="${hcL}" stroke-width="${w + 2}" stroke-linecap="round" opacity="${o}" filter="url(#${u}b2)"/>`;
    const strand = (d, w = 2, o = 0.35) => `<path d="${d}" fill="none" stroke="${hcLine}" stroke-width="${w}" stroke-linecap="round" opacity="${o * 0.8}" filter="url(#${u}b05)"/>`;
    const dome = (top, side, sy) => `M${CX - side} ${sy} C${CX - side - 3} ${top + 46} ${CX - 64} ${top} ${CX} ${top} C${CX + 64} ${top} ${CX + side + 3} ${top + 46} ${CX + side} ${sy}`;
    const lineStd = (side, sy, hl = 110) => ` L${CX + side - 9} ${sy} C${CX + 88} ${sy - 44} ${CX + 82} ${hl + 14} ${CX + 62} ${hl + 4} C${CX + 30} ${hl - 6} ${CX - 30} ${hl - 6} ${CX - 62} ${hl + 4} C${CX - 82} ${hl + 14} ${CX - 88} ${sy - 44} ${CX - side + 9} ${sy}Z`;
    // long framing pieces (left; mirrored for right)
    const frameL = (bottom = 300, inX = 84) => `M${CX - 4} 58 C${CX - 62} 58 ${CX - 102} 96 ${CX - 106} 168 C${CX - 109} 222 ${CX - 106} ${bottom - 34} ${CX - 98} ${bottom} L${CX - inX} ${bottom} C${CX - inX - 4} ${bottom - 50} ${CX - inX - 6} 210 ${CX - inX + 2} 160 C${CX - inX + 10} 120 ${CX - 44} 98 ${CX - 4} 96Z`;
    const longBack = (bottom, wave = 0) => {
      const w = (n) => (wave ? ` Q${CX - 132 + n * 10} ${bottom - 60 + n * 18} ${CX - 116 + n * 4} ${bottom - 30 + n * 14}` : "");
      return `M${CX - 104} 130 C${CX - 120} 200 ${CX - 128} ${bottom - 90} ${CX - 124} ${bottom}${w(0)} L${CX + 124} ${bottom} C${CX + 128} ${bottom - 90} ${CX + 120} 200 ${CX + 104} 130 C${CX + 96} 70 ${CX + 60} 46 ${CX} 46 C${CX - 60} 46 ${CX - 96} 70 ${CX - 104} 130Z`;
    };
    /* ---- hair: men's cuts. Short tapered sides + a sculpted top: clumps, soft shading, fine strands ---- */
    let seed = 7; for (const ch of c.hair) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
    const R = (() => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const nrm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const big = size >= 150;
    const hcDD = sh(hc, -0.55), hcS = mix(hcL, "#FFFFFF", lum(hc) > 0.6 ? 0.25 : 0.42);
    let hdefs = "", hid = 0;
    const PP = (x, y) => `${(+x).toFixed(1)} ${(+y).toFixed(1)}`;
    const pt = ([x, y]) => [CX + x, y];
    const mirL = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
    const cr = (pts0, closed = true, k = 1 / 6) => {
      const pts = pts0.map(pt), n = pts.length, g = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
      let d = `M${PP(...pts[0])}`;
      for (let i = 0; i < (closed ? n : n - 1); i++) { const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2); d += ` C${PP(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k)} ${PP(p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k)} ${PP(...p2)}`; }
      return d + (closed ? "Z" : "");
    };
    const cub = (p) => `M${PP(...p[0])}C${PP(...p[1])} ${PP(...p[2])} ${PP(...p[3])}`;
    const G4 = (a) => a.map(pt);
    const lerpC = (a, b, t) => a.map((q, i) => [q[0] + (b[i][0] - q[0]) * t, q[1] + (b[i][1] - q[1]) * t]);
    const split = (p, t) => { const L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; const a = L(p[0], p[1]), b = L(p[1], p[2]), e = L(p[2], p[3]), d = L(a, b), f = L(b, e), m = L(d, f); return [[p[0], a, d, m], [m, f, e, p[3]]]; };
    const subC = (p, t0, t1) => split(split(p, t1)[0], t0 / t1)[1];
    const ptOn = (p, t) => split(p, Math.max(0.001, Math.min(0.999, t)))[0][3];
    const fanC = (n, A, B) => Array.from({ length: n }, (_, i) => lerpC(G4(A), G4(B), n === 1 ? 0 : i / (n - 1)));
    const hclip = (d) => { const id = `${u}hk${++hid}`; hdefs += `<clipPath id="${id}"><path d="${d}"/></clipPath>`; return id; };
    const HF = (id, sd) => `<filter id="${u}${id}" filterUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
    const speck = (id, col, freq, sd, gain, bias, oct = 2) => { const [r, g, b] = rgb(col).map((v) => (v / 255).toFixed(3)); return `<filter id="${u}${id}" filterUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${sd}"/><feColorMatrix values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${gain} 0 0 0 ${bias}"/></filter>`; };
    hdefs += HF("g05", 0.6) + HF("g1", 1.1) + HF("g2", 2.2) + HF("g4", 4) + HF("g8", 8)
      + speck("sd", hcDD, 1.25, 3, 3.4, -1.5) + speck("sl", hcS, 1.25, 8, 3, -1.62) + speck("cd", hcDD, 0.3, 5, 3.4, -1.38) + speck("cl", hcS, 0.3, 11, 3.2, -1.72) + speck("cb", hcDD, 0.045, 2, 2.2, -0.95, 3)
      + `<linearGradient id="${u}hg" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="230"><stop offset="0" stop-color="${hcL}"/><stop offset=".32" stop-color="${hc}"/><stop offset="1" stop-color="${hcD}"/></linearGradient>`
      + `<radialGradient id="${u}hr2" gradientUnits="userSpaceOnUse" cx="${CX - 34}" cy="56" r="190"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/></radialGradient>`;
    const texR = (filt, a) => `<rect x="${CX - 230}" y="-130" width="460" height="520" filter="url(#${u}${filt})" opacity="${a}"/>`;
    const strandsArt = (g, n) => {
      if (!big || g.length < 2 || !n) return "";
      const dk = [], lt = [];
      for (let i = 0; i < n; i++) {
        const k = Math.floor(R() * (g.length - 1)); let p = lerpC(g[k], g[k + 1], R());
        const j = (R() - 0.5) * 4; p = p.map(([x, y], m) => [x + j * (m / 3), y + j * 0.4 * (m / 3)]);
        const q = subC(p, R() * 0.3, 0.62 + R() * 0.38);
        (R() < 0.6 ? dk : lt).push(cub(q));
      }
      return `<path d="${dk.join("")}" fill="none" stroke="${hcDD}" stroke-width="1.1" opacity=".34" stroke-linecap="round" filter="url(#${u}g05)"/><path d="${lt.join("")}" fill="none" stroke="${hcS}" stroke-width=".95" opacity="${lum(hc) > 0.6 ? 0.22 : 0.2}" stroke-linecap="round" filter="url(#${u}g05)"/>`;
    };
    // a sculpted piece of hair: base color, rim shading, clump grooves + ridges, fine strands, sheen
    const vol = (d, o = {}) => {
      const id = hclip(d), g = o.guides || [], gl = o.gloss ?? 0.3;
      let a = `<rect x="${CX - 230}" y="-130" width="460" height="520" fill="url(#${u}hr2)"/>`;
      if (o.tex === "coil") a += texR("cb", 0.35) + texR("cd", 0.7) + texR("cl", 0.45);
      else if (o.tex === "short") a += texR("sd", 0.6) + texR("sl", 0.35);
      a += `<path d="${d}" fill="none" stroke="${hcDD}" stroke-width="${o.edge ?? 18}" opacity="${o.edgeA ?? 0.55}" filter="url(#${u}g8)"/>`;
      if (g.length) {
        a += `<path d="${g.map((p) => cub(p.map(([x, y]) => [x + (o.rx ?? -4), y + (o.ry ?? -1)]))).join("")}" fill="none" stroke="${hcL}" stroke-width="${o.rw ?? 6}" opacity="${o.ra ?? 0.26}" stroke-linecap="round" filter="url(#${u}g4)"/>`;
        a += `<path d="${g.filter((_, i) => i % (o.every || 1) === 0).map(cub).join("")}" fill="none" stroke="${hcDD}" stroke-width="${o.gw ?? 3.4}" opacity="${o.ga ?? 0.5}" stroke-linecap="round" filter="url(#${u}g2)"/>`;
        a += strandsArt(g, o.n ?? 110);
      }
      if (o.sheen) a += `<path d="${o.sheen}" fill="none" stroke="${hcS}" stroke-width="${o.sw ?? 16}" opacity="${(gl * (lum(hc) > 0.6 ? 0.5 : 1)).toFixed(2)}" stroke-linecap="round" filter="url(#${u}g8)"/><path d="${o.sheen}" fill="none" stroke="${hcS}" stroke-width="3.5" opacity="${(gl * 0.55).toFixed(2)}" stroke-linecap="round" filter="url(#${u}g2)"/>`;
      const body = `<path d="${d}" fill="url(#${u}hg)"/><g clip-path="url(#${id})">${a}${o.extra || ""}</g>`;
      if (!o.fade) return body;
      const mid = `${u}tf${++hid}`;
      hdefs += `<linearGradient id="${mid}g" gradientUnits="userSpaceOnUse" x1="0" y1="${o.fade[0]}" x2="0" y2="${o.fade[1]}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${mid}" maskUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900"><rect x="-150" y="-200" width="700" height="900" fill="url(#${mid}g)"/></mask>`;
      return `<g mask="url(#${mid})">${body}</g>`;
    };
    // the short hair around the sides/back of the head, with the natural hairline
    const rimL = (out, low = 150, lowOut = out) => [[-(92 + lowOut), low], [-(86 + (out + lowOut) * 0.5 * 0.95), 127 - out * 0.3], [-(67 + out * 0.7), 98 - out * 0.7], [-(38 + out * 0.3), 79 - out * 0.95]];
    const sidesD = (o) => {
      const y = o.y, r = o.rec, sb = o.sb, out = o.out;
      const left = [[-81, sb], [-91, sb + 1], [-(92 + out * 0.6), 188], [-(92 + out), 162], [-(86 + out * 0.95), 127 - out * 0.3], [-(67 + out * 0.7), 98 - out * 0.7], [-(38 + out * 0.3), 79 - out * 0.95]];
      const line = [[79.5, sb - 8], [79, 160], [76, y + 26], [66, y + 6], [50, y - 3 - r], [28, y - 1]];
      return cr([...left, [0, 72 - out], ...mirL(left), ...line, [0, y], ...mirL(line)]);
    };
    const sidesArt = (o) => {
      const d = sidesD(o), id = hclip(d), base = mix(hc, sk, o.skin ?? 0.18), keep = (1 - o.fade).toFixed(2);
      hdefs += `<linearGradient id="${u}sg" gradientUnits="userSpaceOnUse" x1="0" y1="${o.fadeTop}" x2="0" y2="${o.sb}"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${base}" stop-opacity="${keep}"/></linearGradient>`
        + `<linearGradient id="${u}sgm" gradientUnits="userSpaceOnUse" x1="0" y1="${o.fadeTop}" x2="0" y2="${o.sb}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${Math.max(0.12, 1 - o.fade * 0.95).toFixed(2)}"/></linearGradient><mask id="${u}sm" maskUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900"><rect x="-150" y="-200" width="700" height="900" fill="url(#${u}sgm)"/></mask>`;
      return `<path d="${d}" fill="url(#${u}sg)" filter="url(#${u}g05)"/><g clip-path="url(#${id})"><g mask="url(#${u}sm)">${texR("sd", 0.75)}${texR("sl", 0.32)}</g><path d="${d}" fill="none" stroke="${hcDD}" stroke-width="12" opacity=".3" filter="url(#${u}g4)"/>${o.shine ? `<ellipse cx="${CX - 22}" cy="88" rx="42" ry="14" fill="${hcS}" opacity=".25" filter="url(#${u}g8)" transform="rotate(-10 ${CX - 22} 88)"/>` : ""}${o.extra || ""}</g>`;
    };
    // hairline helper: y on a soft M-shaped hairline at dx
    const hlY = (dx, y = 110, r = 5) => { const a = Math.abs(dx); return a <= 50 ? y - (a / 50) * (3 + r) : y - 3 - r + (a - 50) * 1.15; };
    // twisted rope (twists, locs)
    const rope = (p, w) => { const d = cub(p); return `<path d="${d}" fill="none" stroke="${hcDD}" stroke-width="${w + 3}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${hc}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${hcDD}" stroke-width="${w}" stroke-dasharray="2.4 4.4" opacity=".5"/><path d="${d}" fill="none" stroke="${hcS}" stroke-width="${(w * 0.28).toFixed(1)}" stroke-linecap="round" opacity=".38" transform="translate(-${(w * 0.22).toFixed(1)} -1)" filter="url(#${u}g05)"/>`; };

    const S0 = { y: 110, rec: 5, sb: 198, out: 4, fade: 0.5, fadeTop: 128 };
    const HS = {
      buzz: () => ({ sides: { ...S0, y: 112, fade: 0.12, fadeTop: 120, out: 3, skin: 0.32, shine: 1 } }),
      crop: () => {
        const TL = [3, -1, 4, 1, 5, 0, 3, -2, 2, 4, 0, 3, 1], tips = []; for (let i = 0; i <= 12; i++) { const x = 72 - i * 12 + (i % 3 - 1) * 1.5; tips.push([x, 121 + TL[i]]); if (i < 12) tips.push([x - 6 + (i % 2), 116.5 + (i % 3) * 0.8]); }
        const d = cr([...rimL(9, 146, 5), [0, 61], ...mirL(rimL(9, 146, 5)), [88, 146], [82, 132], [76, 124], ...tips, [-76, 124], [-82, 132], [-88, 146]]);
        const guides = [-98, -86, -72, -58, -44, -30, -16, -2, 12, 26, 40, 54, 68, 82, 96].map((dx) => { const side = Math.abs(dx) > 76; return G4([[dx * 0.22, 64], [dx * 0.5, 76], [dx * 0.86, side ? 104 : 98], [dx, side ? 146 : 126]]); });
        return { sides: { ...S0, y: 114, fade: 0.6 }, top: vol(d, { guides, sheen: cr([[-62, 88], [-20, 74], [34, 76]], false), gloss: 0.32, ry: -2, fade: [128, 150] }), sil: [d] };
      },
      fade: () => {
        const d = cr([...rimL(13, 134, 4), [0, 58], ...mirL(rimL(13, 134, 4)), [82, 134], [74, 118], [62, 110.5], [30, 110], [0, 110], [-30, 110], [-62, 110.5], [-74, 118], [-82, 134]]);
        return { sides: { ...S0, y: 110, rec: 0, fade: 0.97, fadeTop: 126, sb: 194, out: 3, skin: 0.1 }, top: vol(d, { tex: "coil", sheen: cr([[-56, 76], [-14, 64], [30, 68]], false), gloss: 0.22, edge: 14 }), sil: [d] };
      },
      sidepart: () => {
        const R1 = cr([[-34, 106], [-38, 84], [-41, 64], [-22, 50], [10, 44], [44, 48], [74, 63], [94, 90], [99, 122], [98, 150], [86, 148], [80, 128], [66, 113], [40, 104], [12, 100], [-14, 101]]);
        const L1 = cr([[-34, 106], [-52, 108], [-66, 114], [-80, 128], [-86, 148], [-98, 150], [-98, 124], [-92, 98], [-76, 74], [-58, 62], [-41, 64], [-38, 84]]);
        const gR = fanC(8, [[-32, 103], [0, 94], [44, 99], [80, 124]], [[-41, 62], [-6, 42], [56, 44], [99, 104]]).concat(fanC(3, [[60, 70], [86, 84], [96, 110], [97, 146]], [[40, 104], [72, 108], [86, 126], [90, 148]]));
        const gL = fanC(5, [[-36, 104], [-50, 105], [-66, 110], [-80, 128]], [[-41, 66], [-62, 64], [-88, 84], [-98, 144]]);
        const part = `<path d="${cr([[-34, 104], [-37, 86], [-40, 66]], false)}" fill="none" stroke="${mix(hcDD, sk, 0.3)}" stroke-width="2.2" opacity=".55" filter="url(#${u}g05)"/>`;
        return { sides: { ...S0, y: 112 }, top: vol(L1, { guides: gL, n: 50, fade: [124, 152] }) + vol(R1, { guides: gR, sheen: cr([[-18, 64], [22, 56], [62, 68]], false), gloss: 0.38, rx: -2, ry: -4, fade: [124, 152] }) + part, sil: [R1, L1] };
      },
      slick: () => {
        const line = [[66, 113], [50, 104], [28, 107], [0, 108], [-28, 107], [-50, 104], [-66, 113]];
        const d = cr([...rimL(10, 150), [0, 60], ...mirL(rimL(10, 150)), [88, 150], [80, 130], ...line, [-80, 130], [-88, 150]]);
        const guides = [-80, -66, -52, -38, -24, -10, 4, 18, 32, 46, 60, 74, 86].map((dx) => { const s = Math.sign(dx) || 1, a = Math.abs(dx); return a > 70 ? G4([[dx, 146], [dx + s * 4, 112], [dx * 0.98, 80], [dx * 0.8, 52]]) : G4([[dx, hlY(dx, 108, 4) + 2], [dx * 1.04, hlY(dx, 108, 4) - 26], [dx * 0.92, 66], [dx * 0.62, 44]]); });
        return { sides: { ...S0, y: 110, rec: 6, fade: 0.45 }, top: vol(d, { guides, sheen: cr([[-50, 92], [-24, 74], [8, 66], [44, 72]], false), gloss: 0.55, rx: -4, ry: 0, gw: 3, ga: 0.55, fade: [126, 152] }), sil: [d] };
      },
      quiff: () => {
        const d = cr([[-98, 150], [-97, 124], [-93, 96], [-80, 70], [-64, 55], [-44, 39], [-18, 31], [8, 29], [34, 33], [58, 45], [78, 63], [92, 76], [98, 100], [99, 124], [98, 150], [86, 148], [80, 128], [66, 112], [40, 106], [10, 105], [-20, 106], [-46, 108], [-66, 114], [-80, 128], [-86, 148]]);
        const guides = [-62, -48, -34, -20, -6, 8, 22, 36, 50, 64].map((dx) => G4([[dx, 108], [dx * 0.98 - 2, 74], [dx * 0.8 - 6, 40], [dx * 0.6 + 10, 20]])).concat([-1, 10].flatMap((s) => [G4([[s * 82, 146], [s * 84, 110], [s * 80, 76], [s * 66, 46]]), G4([[s * 74, 120], [s * 74, 90], [s * 68, 60], [s * 56, 34]])]));
        return { sides: { ...S0, y: 110, fade: 0.72, sb: 196 }, top: vol(d, { guides, sheen: cr([[-50, 53], [-16, 39], [20, 39], [52, 49]], false), gloss: 0.45, rx: -5, ry: 2, edge: 20, fade: [126, 152] }), sil: [d] };
      },
      spiky: () => {
        const T = [[-92, 82], [-80, 60], [-60, 46], [-38, 40], [-12, 30], [14, 38], [40, 34], [62, 50], [82, 66], [94, 84]], V = [[-90, 90], [-74, 70], [-50, 64], [-24, 58], [2, 56], [30, 58], [54, 66], [74, 68], [90, 90]];
        const top = []; T.forEach((t, i) => { top.push([t[0] - 6, t[1] + 6], [t[0] + 1, t[1]], [t[0] + 6, t[1] + 5]); if (V[i]) top.push(V[i]); });
        const front = [[68, 117], [56, 104], [48, 113], [36, 100], [26, 111], [12, 98], [0, 109], [-12, 98], [-24, 110], [-36, 100], [-46, 112], [-58, 104], [-68, 117]];
        const d = cr([[-98, 150], [-97, 124], [-94, 98], ...top, [94, 98], [97, 124], [98, 150], [86, 148], [80, 128], ...front, [-80, 128], [-86, 148]]);
        const guides = T.map(([tx, ty]) => G4([[tx * 1.04, 112 + Math.abs(tx) * 0.25], [tx * 1.03, 92], [tx, ty + 26], [tx, ty]])).concat(front.filter((_, i) => i % 2).map(([x, y]) => G4([[x * 1.05, 118], [x * 1.04, 112], [x, y + 6], [x, y]])));
        return { sides: { ...S0, y: 112, fade: 0.75 }, top: vol(d, { guides, sheen: cr([[-50, 68], [-10, 54], [36, 60]], false), gloss: 0.38, rx: -3, ry: 0, n: 130, fade: [126, 152] }), sil: [d] };
      },
      curlytop: () => {
        const pts = []; for (let i = 0; i <= 22; i++) { const a = Math.PI * (1 + i / 22), r = (i % 2 ? 98 : 106); pts.push([Math.cos(a) * r, 128 + Math.sin(a) * (i % 2 ? 84 : 92)]); }
        const front = []; for (let i = 0; i <= 12; i++) { const x = 84 - i * 14; front.push([x, (i % 2 ? 106 : 116) + (Math.abs(x) > 60 ? 10 : 0)]); }
        const d = cr([...pts.filter(([, y]) => y < 150), ...front]);
        const blobs = []; for (let y = 34; y <= 118; y += 12) for (let x = -96; x <= 96; x += 13) { const jx = x + (R() - 0.5) * 7 + (((y - 34) / 12) % 2 ? 6 : 0), jy = y + (R() - 0.5) * 6; if (Math.hypot(jx / 100, (jy - 128) / 92) < 0.97 && jy < (Math.abs(jx) > 60 ? 128 : 116)) blobs.push([jx, jy, 8.5 + R() * 3]); }
        hdefs += `<radialGradient id="${u}cbg" cx=".38" cy=".32" r=".7"><stop offset="0" stop-color="${hcL}"/><stop offset=".55" stop-color="${hc}"/><stop offset="1" stop-color="${hcDD}"/></radialGradient>`;
        const curls = `<path d="${blobs.map(([x, y, r]) => `M${PP(CX + x + 2 - r, y + 3)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join("")}" fill="${hcDD}" opacity=".55" filter="url(#${u}g2)"/>${blobs.map(([x, y, r]) => `<circle cx="${(CX + x).toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#${u}cbg)"/>`).join("")}<path d="${blobs.map(([x, y, r]) => `M${PP(CX + x - r * 0.55, y + r * 0.1)}q${(r * 0.55).toFixed(1)} ${(-r * 0.75).toFixed(1)} ${(r * 1.1).toFixed(1)} 0`).join("")}" fill="none" stroke="${hcDD}" stroke-width="1.3" opacity=".45"/>`;
        return { sides: { ...S0, y: 114, fade: 0.85 }, top: vol(d, { tex: "coil", extra: curls + texR("cd", 0.45), sheen: cr([[-50, 60], [-10, 46], [34, 54]], false), gloss: 0.2, edge: 12 }), sil: [d] };
      },
      waves: () => {
        let rings = "";
        for (let r = 40, k = 0; r < 190; r += 8, k++) { let dd = ""; for (let i = 0; i <= 48; i++) { const a = Math.PI * (i / 48), rr = r + 2.4 * Math.sin(a * 16 + r * 0.7); dd += `${i ? "L" : "M"}${PP(CX + Math.cos(a) * rr * 1.05, 18 + Math.sin(a) * rr)}`; } rings += `<path d="${dd}" fill="none" stroke="${k % 2 ? hcS : hcDD}" stroke-width="${k % 2 ? 2.4 : 3.4}" opacity="${k % 2 ? 0.3 : 0.4}" filter="url(#${u}g1)"/>`; }
        return { sides: { ...S0, y: 108, rec: 0, fade: 0.08, fadeTop: 120, out: 3, skin: 0.12, shine: 1, extra: rings } };
      },
      afro: () => {
        const n = 44, blob = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = 1 + 0.035 * Math.sin(i * 2.7) + (i % 2 ? 0.025 : -0.01); blob.push([Math.cos(a) * 128 * b, 114 + Math.sin(a) * 100 * b]); }
        const d = cr(blob);
        const back = vol(d, { tex: "coil", sheen: cr([[-80, 30], [-30, 6], [30, 8]], false), gloss: 0.16, edge: 30, edgeA: 0.5 });
        const id = hclip(d);
        return { back: `<g filter="url(#${u}g05)">${back}</g>`, sides: { ...S0, y: 106, rec: 0, fade: 0.05, fadeTop: 120, sb: 196, out: 6, skin: 0.05, extra: texR("cd", 0.55) + texR("cl", 0.3) }, sil: [] };
      },
      twists: () => {
        const cap = cr([...rimL(6, 140), [0, 66], ...mirL(rimL(6, 140)), [86, 140], [80, 128], [66, 114], [40, 109], [0, 110], [-40, 109], [-66, 114], [-80, 128], [-86, 140]]);
        const list = []; const rows = [[52, 9, 20], [62, 12, 22], [74, 13, 24], [88, 13, 22], [102, 11, 18]];
        rows.forEach(([y, nCols, len], ri) => { for (let i = 0; i < nCols; i++) { const t = nCols === 1 ? 0.5 : i / (nCols - 1); const dx = (t - 0.5) * (2 * Math.min(90, 40 + ri * 16 + (y - 50) * 0.5)); const base = [dx, y + Math.abs(dx) * 0.28]; const dir = nrm([dx * 0.75, -(120 - Math.abs(dx) * 0.5)]); const L = len + (R() - 0.5) * 8; const tip = [base[0] + dir[0] * L, base[1] + dir[1] * L]; list.push(G4([base, [base[0] + dir[0] * L * 0.35 + (R() - 0.5) * 4, base[1] + dir[1] * L * 0.35], [tip[0] - dir[0] * L * 0.3 + (R() - 0.5) * 6, tip[1] - dir[1] * L * 0.3], tip])); } });
        return { sides: { ...S0, y: 112, fade: 0.82 }, top: vol(cap, { tex: "coil", edge: 10 }) + list.map((p) => rope(p, 12.5)).join(""), sil: [cap] };
      },
      locs: () => {
        // real locs: round, twisted ropes with fuzzy texture, rooted in sections, falling to the shoulders
        const cap = cr([...rimL(6, 150), [0, 62], ...mirL(rimL(6, 150)), [88, 150], [80, 128], [66, 114], [40, 109], [0, 110], [-40, 109], [-66, 114], [-80, 128], [-88, 150]]);
        const tube = (p, w, tone = 0) => {
          const d = cub(p), base = tone ? mix(hc, hcDD, 0.35) : hc;
          let ridges = "";
          const n = Math.max(4, Math.round((Math.hypot(p[3][0] - p[0][0], p[3][1] - p[0][1]) + 20) / (w * 0.62)));
          for (let k = 1; k < n; k++) { const t = k / n, q = ptOn(p, t), q2 = ptOn(p, Math.min(0.999, t + 0.01)); const a = Math.atan2(q2[1] - q[1], q2[0] - q[0]), b = a + 1.05, h = w * 0.5; ridges += `M${PP(q[0] - Math.cos(b) * h, q[1] - Math.sin(b) * h)}L${PP(q[0] + Math.cos(b) * h, q[1] + Math.sin(b) * h)}`; }
          return `<path d="${d}" fill="none" stroke="${hcDD}" stroke-width="${w + 2.6}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${base}" stroke-width="${w}" stroke-linecap="round"/><path d="${ridges}" stroke="${hcDD}" stroke-width="${(w * 0.22).toFixed(1)}" opacity=".5" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${hcS}" stroke-width="${(w * 0.3).toFixed(1)}" stroke-linecap="round" opacity="${tone ? 0.18 : 0.32}" transform="translate(-${(w * 0.2).toFixed(1)} -0.6)" filter="url(#${u}g1)"/><path d="${d}" fill="none" stroke="#000" stroke-width="${(w * 0.35).toFixed(1)}" stroke-linecap="round" opacity=".22" transform="translate(${(w * 0.28).toFixed(1)} 0.6)" filter="url(#${u}g1)"/>`;
        };
        const fuzzOver = (paths, w) => { const id = `${u}lm${++hid}`; hdefs += `<mask id="${id}" maskUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900">${paths.map((p) => `<path d="${cub(p)}" fill="none" stroke="#fff" stroke-width="${w + 2}" stroke-linecap="round"/>`).join("")}</mask>`; return `<g mask="url(#${id})">${texR("cd", 0.55)}${texR("cl", 0.4)}</g>`; };
        const J = (k) => (((k * 7919) % 97) / 97 - 0.5);
        // back layer: behind the head, falling past the ears to the shoulders
        const back = [];
        for (let i = 0; i < 9; i++) for (const s of [-1, 1]) { const x0 = s * (10 + i * 10), y0 = 58 + i * 4, end = 238 + ((i * 23) % 40); back.push(G4([[x0, y0], [s * (70 + i * 5), y0 - 8], [s * (104 + i * 1.2 + J(i) * 6), 150], [s * (96 + i * 2.2 + J(i + 3) * 10), end]])); }
        // top layer: roots in a grid, pulled back from the hairline over the crown
        const top = [];
        for (let i = 0; i < 9; i++) { const dx = -64 + i * 16; top.push(G4([[dx, hlY(dx, 112, 3) - 1], [dx * 1.04, 92], [dx * 1.0, 72], [dx * 0.86 + J(i) * 4, 54]])); }
        // side layer: drops from the temples, in front of the ears
        const side = [];
        for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const x0 = s * (70 + i * 7); side.push(G4([[x0, 92 + i * 7], [s * (94 + i * 2), 112 + i * 6], [s * (100 + i * 1.5 + J(i) * 4), 170], [s * (95 + i * 2.5 + J(i + 5) * 6), 222 + i * 12 + ((i * 13) % 14)]])); }
        const W = 10.5;
        const backArt = back.map((p) => tube(p, W, 1)).join("") + fuzzOver(back, W);
        const frontArt = top.map((p) => tube(p, W - 0.5)).join("") + fuzzOver(top, W - 0.5) + side.map((p) => tube(p, W)).join("") + fuzzOver(side, W);
        const roots = `<g fill="${mix(hcDD, sk, 0.35)}" opacity=".5">${top.map((p) => `<ellipse cx="${p[0][0].toFixed(1)}" cy="${(p[0][1] + 2).toFixed(1)}" rx="5" ry="2.2"/>`).join("")}</g>`;
        return { back: backArt, sides: { ...S0, y: 112, fade: 0.3 }, top: vol(cap, { tex: "coil", edge: 12 }) + frontArt + roots, sil: [cap], longBack: 1 };
      },
      braids: () => {
        let art = ""; const parts = [];
        for (let i = 0; i < 8; i++) {
          const dx = -70 + i * 20, y0 = hlY(dx, 108, 0) + 1, p = G4([[dx, y0], [dx * 0.98, 82], [dx * 0.72, 56], [dx * 0.4, 36]]);
          parts.push(cub(lerpC(p, p.map(([x, y]) => [x + 10, y]), 1).map(([x, y], m) => [x, y])));
          for (let k = 0; k < 13; k++) { const t = k / 13, q = ptOn(p, t), q2 = ptOn(p, t + 0.02), ang = (Math.atan2(q2[1] - q[1], q2[0] - q[0]) * 180) / Math.PI + (k % 2 ? 28 : -28), rx = 6.4 - t * 2.4, ry = 3.6 - t * 1.2; art += `<ellipse cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${ang.toFixed(0)} ${q[0].toFixed(1)} ${q[1].toFixed(1)})" fill="url(#${u}pl)" stroke="${hcDD}" stroke-width=".9"/>`; }
        }
        hdefs += `<radialGradient id="${u}pl" cx=".4" cy=".3" r=".75"><stop offset="0" stop-color="${hcL}"/><stop offset=".6" stop-color="${hc}"/><stop offset="1" stop-color="${hcDD}"/></radialGradient>`;
        const scalp = `<path d="${parts.join("")}" fill="none" stroke="${mix(hcDD, sk, 0.55)}" stroke-width="1.6" opacity=".55"/>`;
        return { sides: { ...S0, y: 108, rec: 0, fade: 0.15, fadeTop: 122, out: 3, skin: 0.2, extra: `<g opacity=".9">${scalp}${art}</g>` } };
      },
      manbun: () => {
        const line = [[66, 113], [50, 104], [28, 107], [0, 108], [-28, 107], [-50, 104], [-66, 113]];
        const d = cr([...rimL(8, 140), [0, 62], ...mirL(rimL(8, 140)), [86, 140], [80, 128], ...line, [-80, 128], [-86, 140]]);
        const guides = [-76, -60, -44, -28, -12, 4, 20, 36, 52, 68, 82].map((dx) => G4([[dx, hlY(dx, 108, 4) + 3], [dx * 1.02, hlY(dx, 108, 4) - 24], [dx * 0.7, 64], [dx * 0.2, 52]]));
        const bun = cr([[-30, 58], [-34, 38], [-22, 22], [0, 16], [24, 22], [34, 38], [30, 58], [0, 64]]);
        const bg = [G4([[-26, 54], [-30, 32], [-6, 20], [16, 26]]), G4([[-16, 58], [-18, 40], [4, 28], [24, 38]]), G4([[0, 60], [-2, 46], [18, 38], [28, 52]])];
        const back = vol(bun, { guides: bg, n: 40, sheen: cr([[-18, 28], [4, 20], [20, 26]], false), gloss: 0.35, edge: 10 });
        return { back, sides: { ...S0, y: 110, rec: 6, fade: 0.65 }, top: vol(d, { guides, sheen: cr([[-46, 90], [-20, 72], [14, 64]], false), gloss: 0.4, fade: [122, 142] }), sil: [d] };
      },
      flow: () => {
        const back = cr([[-96, 110], [-104, 150], [-108, 186], [-112, 212], [-102, 220], [-104, 230], [-88, 226], [-60, 222], [0, 222], [60, 222], [88, 226], [104, 230], [102, 220], [112, 212], [108, 186], [104, 150], [96, 110], [74, 66], [0, 54], [-74, 66]]);
        const gB = [-1, 1].flatMap((s) => fanC(4, [[s * 92, 110], [s * 102, 150], [s * 106, 190], [s * 108, 222]], [[s * 80, 150], [s * 92, 180], [s * 98, 206], [s * 100, 226]]));
        const line = [[66, 113], [50, 103], [28, 105], [0, 106], [-28, 105], [-50, 103], [-66, 113]];
        const d = cr([[-100, 158], [-102, 128], ...rimL(12, 128).slice(1), [0, 56], ...mirL(rimL(12, 128).slice(1)), [102, 128], [100, 158], [94, 156], [86, 140], [78, 126], ...line, [-78, 126], [-86, 140], [-94, 156]]);
        const guides = [-70, -54, -38, -22, -6, 10, 26, 42, 58, 72].map((dx) => G4([[dx, hlY(dx, 106, 3) + 2], [dx * 1.06, 80], [dx * 1.08, 60], [dx * 1.2, 40]])).concat([-1, 1].flatMap((s) => fanC(3, [[s * 76, 120], [s * 90, 108], [s * 100, 130], [s * 100, 170]], [[s * 60, 80], [s * 88, 80], [s * 104, 120], [s * 104, 160]])));
        return { back: vol(back, { guides: gB, n: 90, edge: 20, edgeA: 0.6 }), sides: { ...S0, y: 108, fade: 0.2 }, top: vol(d, { guides, sheen: cr([[-56, 86], [-24, 68], [16, 62], [52, 70]], false), gloss: 0.42, rx: -4, ry: 2 }), sil: [d], longBack: 1 };
      },
      mohawk: () => {
        const d = cr([[-32, 112], [-38, 88], [-40, 64], [-36, 46], [-30, 34], [-22, 28], [-14, 32], [-6, 20], [4, 26], [12, 16], [20, 26], [28, 24], [36, 38], [40, 58], [40, 82], [36, 100], [32, 112], [10, 109], [-10, 109]]);
        const guides = [-30, -20, -10, 0, 10, 20, 30].map((dx, i) => G4([[dx, 110], [dx * 1.08, 80], [dx * 0.98, 48], [[-24, -14, -6, 4, 12, 20, 30][i], [30, 32, 22, 26, 18, 26, 30][i]]]));
        return { sides: { ...S0, y: 112, fade: 0.93, fadeTop: 110, skin: 0.25 }, top: vol(d, { guides, sheen: cr([[-12, 80], [-14, 40], [-6, 6]], false), gloss: 0.4, n: 60, edge: 10 }), sil: [d] };
      },
      bald: () => ({ top: `<ellipse cx="${CX - 26}" cy="96" rx="24" ry="10" fill="#fff" opacity=".22" filter="url(#${u}g4)" transform="rotate(-18 ${CX - 26} 96)"/>` }),
    };
    const HD = (HS[c.hair] || HS.crop)();
    const sidesHair = HD.sides ? sidesArt(HD.sides) : "";
    // hats press the hair down: hide hair above the brim
    const clipAttr = hasHat && hatClip ? ` clip-path="url(#${u}hc)"` : "";
    let hairBackArt = HD.back ? `<g transform="${HT}"${hasHat && !HD.longBack ? clipAttr : ""}>${HD.back}</g>` : "";
    let hairFrontArt = c.hair === "bald" ? `<g transform="${HT}">${HD.top}</g>` : `<g transform="${HT}"${clipAttr}>${sidesHair}${HD.top || ""}</g>`;
    const silD = [HD.sides ? sidesD(HD.sides) : "", ...(HD.sil || [])].filter(Boolean);
    const hairShadow = silD.length ? `<g clip-path="url(#${u}fc)" opacity=".34" filter="url(#${u}b4)"><g transform="translate(0 5) ${HT}"${clipAttr}>${silD.map((d) => `<path d="${d}" fill="${skLine}"/>`).join("")}</g></g>` : "";
    const hairBackVol = "", hairVol = "";
    defs = defs.replace("</defs>", hdefs + "</defs>");

    /* ---- body ---- */
    const torso = `M${CX - nw - 6} 326 C${CX - nw - 22} 350 ${CX - SW + 44} 360 ${CX - SW + 16} 376 C${CX - SW - 6} 390 ${CX - SW - 14} 440 ${CX - SW - 16} 620 L${CX + SW + 16} 620 C${CX + SW + 14} 440 ${CX + SW + 6} 390 ${CX + SW - 16} 376 C${CX + SW - 44} 360 ${CX + nw + 22} 350 ${CX + nw + 6} 326Z`;
    const armL = `M${CX - SW + 40} 404 C${CX - SW + 44} 450 ${CX - SW + 42} 500 ${CX - SW + 40} 560`, armR = mir(armL.replace(/SW/g, ""));
    const tcD = sh(tc, -0.22), tcDD = sh(tc, -0.36), ocD = sh(oc, -0.25);
    const folds = `<path d="M${CX - SW + 40} 404 C${CX - SW + 44} 450 ${CX - SW + 42} 500 ${CX - SW + 40} 560 M${CX + SW - 40} 404 C${CX + SW - 44} 450 ${CX + SW - 42} 500 ${CX + SW - 40} 560" stroke="#000" stroke-opacity=".3" stroke-width="7" fill="none" filter="url(#${u}b4)"/><path d="M${CX - SW + 46} 404 C${CX - SW + 50} 450 ${CX - SW + 48} 500 ${CX - SW + 46} 560" stroke="#fff" stroke-opacity=".12" stroke-width="5" fill="none" filter="url(#${u}b2)"/>`;
    const crew = `<path d="M${CX - nw - 8} 330 C${CX - nw} 360 ${CX + nw} 360 ${CX + nw + 8} 330" stroke="${tcD}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    const neckSkinV = (depth) => `<path d="M${CX - nw - 6} 326 L${CX} ${depth} L${CX + nw + 6} 326Z" fill="url(#${u}nk)"/>`;
    const baseTop = (f = `url(#${u}tp)`) => `<path d="${torso}" fill="${f}"/>`;

    // garment helpers: real buttons, stitching, ribbing, seams and collar shadows
    const btn = (x, y, r, col) => `<circle cx="${x}" cy="${y + 0.9}" r="${r}" fill="#000" opacity=".28"/><circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><circle cx="${x}" cy="${y}" r="${(r * 0.7).toFixed(2)}" fill="none" stroke="${sh(col, -0.3)}" stroke-width=".7"/><g fill="${sh(col, -0.5)}">${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => `<circle cx="${(x + a * r * 0.26).toFixed(2)}" cy="${(y + b * r * 0.26).toFixed(2)}" r="${(r * 0.13).toFixed(2)}"/>`).join("")}</g><circle cx="${(x - r * 0.38).toFixed(2)}" cy="${(y - r * 0.42).toFixed(2)}" r="${(r * 0.28).toFixed(2)}" fill="#fff" opacity=".5"/>`;
    const stitch = (d, col, o = 0.55) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.1" stroke-dasharray="3 2.4" opacity="${o}" stroke-linecap="round"/>`;
    const rib = (d, w, col) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${sh(col, -0.28)}" stroke-width="${w - 1}" stroke-dasharray="1.3 2.6" opacity=".6"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1.2" opacity=".18" transform="translate(0 -${(w / 2 - 0.6).toFixed(1)})"/>`;
    const seams = (col) => `<path d="M${CX - nw - 14} 336 C${CX - nw - 40} 352 ${CX - SW + 52} 364 ${CX - SW + 36} 386 M${CX + nw + 14} 336 C${CX + nw + 40} 352 ${CX + SW - 52} 364 ${CX + SW - 36} 386" stroke="${col}" stroke-width="1.5" fill="none" opacity=".5"/>`;
    const cshadow = (d) => `<path d="${d}" fill="#000" opacity=".3" filter="url(#${u}b2)" transform="translate(0 3)"/>`;
    const crewD = `M${CX - nw - 8} 330 C${CX - nw} 360 ${CX + nw} 360 ${CX + nw + 8} 330`;
    const collarL = `M${CX - nw - 9} 324 L${CX - 1} 352 L${CX - 20} 378 L${CX - nw - 24} 342Z`;
    const collars = (fill) => `${cshadow(collarL + " " + mir(collarL))}<path d="${collarL}" fill="${fill}" stroke="${tcD}" stroke-width="1.6" stroke-linejoin="round"/><path d="${mir(collarL)}" fill="${fill}" stroke="${tcD}" stroke-width="1.6" stroke-linejoin="round"/>${stitch(`M${CX - nw - 6} 330 L${CX - 4} 354 L${CX - 19} 373`, tcDD, 0.4)}${stitch(mir(`M${CX - nw - 6} 330 L${CX - 4} 354 L${CX - 19} 373`), tcDD, 0.4)}`;
    const TOP = {
      tee: baseTop() + folds + seams(tcD) + rib(crewD, 8, tcD),
      vneck: baseTop() + folds + seams(tcD) + neckSkinV(392) + rib(`M${CX - nw - 8} 328 L${CX} 394 L${CX + nw + 8} 328`, 7, tcD),
      tank: `<path d="${torso}" fill="url(#${u}nk)"/><path d="M${CX - SW + 70} 372 C${CX - SW + 74} 400 ${CX - 60} 420 ${CX - 50} 330 L${CX - nw - 2} 330 C${CX - nw + 4} 380 ${CX + nw - 4} 380 ${CX + nw + 2} 330 L${CX + 50} 330 C${CX + 60} 420 ${CX + SW - 74} 400 ${CX + SW - 70} 372 C${CX + SW - 50} 420 ${CX + SW - 46} 480 ${CX + SW - 44} 560 L${CX - SW + 44} 560 C${CX - SW + 46} 480 ${CX - SW + 50} 420 ${CX - SW + 70} 372Z" fill="url(#${u}tp)"/>`,
      polo: baseTop() + folds + seams(tcD) + `<rect x="${CX - 8}" y="352" width="16" height="56" rx="2" fill="${sh(tc, 0.06)}" stroke="${tcD}" stroke-width="1.2"/>${stitch(`M${CX - 5} 356 V404 M${CX + 5} 356 V404 M${CX - 5} 404 H${CX + 5}`, tcDD, 0.45)}${btn(CX, 370, 3.4, sh(tc, 0.25))}${btn(CX, 392, 3.4, sh(tc, 0.25))}` + collars(sh(tc, 0.08)),
      buttondown: baseTop() + folds + seams(tcD) + `<rect x="${CX - 7}" y="352" width="14" height="260" fill="${sh(tc, 0.05)}"/>${stitch(`M${CX - 5} 356 V600 M${CX + 5} 356 V600`, tcDD, 0.4)}${[386, 422, 458, 494, 530].map((y) => btn(CX, y, 3.3, sh(tc, lum(tc) > 0.6 ? -0.05 : 0.3))).join("")}<path d="M${CX + 44} 418 h36 v32 c0 5 -36 5 -36 0z" fill="${sh(tc, 0.03)}" stroke="${tcD}" stroke-width="1.4"/>${stitch(`M${CX + 46} 424 h32`, tcDD, 0.45)}` + collars(sh(tc, 0.1)),
      hoodie: baseTop() + folds + seams(tcD) + `<path d="M${CX - nw - 18} 330 C${CX - nw - 6} 370 ${CX + nw + 6} 370 ${CX + nw + 18} 330" stroke="${tcDD}" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M${CX - nw - 18} 330 C${CX - nw - 6} 370 ${CX + nw + 6} 370 ${CX + nw + 18} 330" stroke="${tcD}" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M${CX - nw - 18} 326 C${CX - nw - 6} 364 ${CX + nw + 6} 364 ${CX + nw + 18} 326" stroke="${sh(tc, 0.2)}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".55"/><circle cx="${CX - 18}" cy="362" r="3.4" fill="url(#${u}mt)"/><circle cx="${CX + 18}" cy="362" r="3.4" fill="url(#${u}mt)"/><path d="M${CX - 18} 362 C${CX - 20} 390 ${CX - 16} 410 ${CX - 19} 428 M${CX + 18} 362 C${CX + 20} 392 ${CX + 15} 412 ${CX + 17} 432" stroke="${sh(tc, 0.4)}" stroke-width="3.6" fill="none" stroke-linecap="round"/><rect x="${CX - 21.5}" y="426" width="5" height="10" rx="2" fill="url(#${u}mt)"/><rect x="${CX + 14.5}" y="430" width="5" height="10" rx="2" fill="url(#${u}mt)"/><path d="M${CX - 74} 600 L${CX - 62} 492 C${CX - 40} 482 ${CX + 40} 482 ${CX + 62} 492 L${CX + 74} 600Z" fill="${tcD}" opacity=".35"/>${stitch(`M${CX - 66} 498 C${CX - 40} 489 ${CX + 40} 489 ${CX + 66} 498`, tcDD, 0.5)}`,
      sweater: baseTop() + folds + seams(tcD) + rib(crewD, 13, tcD) + `<g fill="none" stroke-linecap="round">${[-46, 46].map((dx) => Array.from({ length: 7 }, (_, k) => { const y = 382 + k * 26; return `<path d="M${CX + dx - 9} ${y} C${CX + dx - 9} ${y + 9} ${CX + dx + 9} ${y + 13} ${CX + dx + 9} ${y + 22}" stroke="${tcDD}" stroke-width="5" opacity=".35"/><path d="M${CX + dx + 9} ${y} C${CX + dx + 9} ${y + 9} ${CX + dx - 9} ${y + 13} ${CX + dx - 9} ${y + 22}" stroke="${sh(tc, 0.2)}" stroke-width="5" opacity=".4"/>`; }).join("")).join("")}</g>`,
      turtleneck: baseTop() + folds + `<path d="M${CX - nw - 4} 290 C${CX - nw - 8} 320 ${CX - nw - 10} 340 ${CX - nw - 6} 352 C${CX - 20} 366 ${CX + 20} 366 ${CX + nw + 6} 352 C${CX + nw + 10} 340 ${CX + nw + 8} 320 ${CX + nw + 4} 290 C${CX + 20} 300 ${CX - 20} 300 ${CX - nw - 4} 290Z" fill="url(#${u}tp)"/><g stroke="${tcD}" stroke-width="2.2" opacity=".55" fill="none"><path d="M${CX - nw - 2} 306 C${CX - 20} 316 ${CX + 20} 316 ${CX + nw + 2} 306"/><path d="M${CX - nw - 4} 322 C${CX - 20} 332 ${CX + 20} 332 ${CX + nw + 4} 322"/><path d="M${CX - nw - 6} 338 C${CX - 20} 348 ${CX + 20} 348 ${CX + nw + 6} 338"/></g>`,
      graphic: baseTop() + folds + crew + (() => { const k = ink(tc, t2); return LOGO(CX, 362, 74, k, lum(tc) > 0.7 ? "#3D8BFF" : "#9CC3F0") + `<text x="${CX}" y="432" text-anchor="middle" font-family="Montserrat,Inter,Arial,sans-serif" font-weight="800" font-size="14" letter-spacing="4" fill="${k}">HIGHPOINT</text><text x="${CX}" y="444" text-anchor="middle" font-family="Montserrat,Inter,Arial,sans-serif" font-weight="700" font-size="7.5" letter-spacing="5" fill="${k}" opacity=".85">FINANCIAL</text>`; })(),
      stripes: baseTop() + `<g clip-path="url(#${u}tor)"><g fill="${t2}">${Array.from({ length: 9 }, (_, i) => `<rect x="0" y="${366 + i * 24}" width="400" height="10"/>`).join("")}</g></g>` + folds + crew,
      jersey: baseTop() + folds + neckSkinV(372) + `<path d="M${CX - nw - 8} 328 L${CX} 374 L${CX + nw + 8} 328" stroke="${t2}" stroke-width="9" fill="none" stroke-linejoin="round"/>${LOGO(CX - 64, 384, 34, ink(tc, t2))}<text x="${CX + 10}" y="500" text-anchor="middle" font-family="Montserrat,Inter,Arial,sans-serif" font-weight="900" font-size="78" fill="${t2}" stroke="${lum(t2) > 0.6 ? "#16161E" : "#fff"}" stroke-width="3" paint-order="stroke">1</text><path d="M${CX - SW - 14} 470 L${CX - SW + 40} 470 M${CX + SW + 14} 470 L${CX + SW - 40} 470" stroke="${t2}" stroke-width="10"/>`,
      blouse: baseTop() + folds + neckSkinV(388) + `<path d="M${CX - nw - 10} 326 C${CX - nw} 356 ${CX - 12} 382 ${CX} 390 C${CX + 12} 382 ${CX + nw} 356 ${CX + nw + 10} 326" stroke="${sh(tc, 0.18)}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M${CX - nw - 10} 326 C${CX - nw} 356 ${CX - 12} 382 ${CX} 390 C${CX + 12} 382 ${CX + nw} 356 ${CX + nw + 10} 326" stroke="${tcD}" stroke-width="2" fill="none" stroke-dasharray="4 4"/>`,
      tropical: baseTop() + `<g clip-path="url(#${u}tor)"><g fill="${t2}" opacity=".85">${[[90, 420, -30], [300, 410, 30], [150, 500, 20], [260, 510, -25], [60, 520, 40], [340, 520, -40], [200, 440, 10]].map(([x, y, r]) => `<g transform="rotate(${r} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="26" ry="10"/><path d="M${x - 24} ${y} h48" stroke="${sh(t2, -0.3)}" stroke-width="2"/></g>`).join("")}</g><g fill="${sh(tc, 0.35)}">${[[120, 470], [280, 460], [210, 520], [70, 460], [330, 470]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`).join("")}</g></g>` + folds + neckSkinV(380) + `<path d="M${CX - nw - 10} 324 L${CX - 2} 382 L${CX - 30} 376 L${CX - nw - 30} 340Z M${CX + nw + 10} 324 L${CX + 2} 382 L${CX + 30} 376 L${CX + nw + 30} 340Z" fill="${sh(tc, 0.12)}" stroke="${tcD}" stroke-width="2.5" stroke-linejoin="round"/>`,
      flannel: baseTop(`url(#${u}plaid)`) + folds + seams(tcDD) + `<rect x="${CX - 7}" y="352" width="14" height="260" fill="url(#${u}plaid)"/><path d="M${CX - 7} 352 V612 M${CX + 7} 352 V612" stroke="${tcDD}" stroke-width="1.2" opacity=".6"/>${[386, 422, 458, 494, 530].map((y) => btn(CX, y, 3.4, "#EDE6D6")).join("")}<path d="M${CX - 82} 414 h40 v34 c0 6 -40 6 -40 0z M${CX + 42} 414 h40 v34 c0 6 -40 6 -40 0z" fill="url(#${u}plaidB)" stroke="${tcDD}" stroke-width="1.2"/><path d="M${CX - 82} 414 h40 v10 h-40z M${CX + 42} 414 h40 v10 h-40z" fill="${tcDD}" opacity=".35"/>` + collars(`url(#${u}plaid)`),
      tiedye: baseTop() + `<g clip-path="url(#${u}tor)"><g filter="url(#${u}b8)">${Array.from({ length: 9 }, (_, i) => { const cols = [t2, "#3DF5FF", "#FFD447", "#B15CFF", "#FF7A3D", "#2FBF71", t2, "#FF4FA3", tc]; const r = 260 - i * 28; return `<ellipse cx="${CX + 6}" cy="470" rx="${r}" ry="${r * 0.82}" fill="${cols[i]}" transform="rotate(${i * 23} ${CX + 6} 470)"/>`; }).join("")}</g><g fill="none" stroke="#fff" stroke-width="5" opacity=".18" filter="url(#${u}b2)">${[40, 80, 120, 160].map((r) => `<path d="M${CX + 6 - r} 470 A${r} ${r * 0.82} 0 1 1 ${CX + 6 + r * 0.7} ${470 - r * 0.58}"/>`).join("")}</g></g>` + folds + rib(crewD, 8, sh(tc, -0.2)),
      camo: baseTop() + `<g clip-path="url(#${u}tor)">${[[sh(tc, -0.3), 0], [t2, 1], [sh(t2, -0.35), 2], [sh(tc, 0.18), 3]].map(([col, k]) => `<g fill="${col}">${Array.from({ length: 9 }, (_, i) => { const x = -170 + ((i * 97 + k * 61) % 340), y = 330 + ((i * 53 + k * 37) % 290); const pts = Array.from({ length: 7 }, (_, j) => { const a = (j / 7) * Math.PI * 2, rr = 18 + ((i * 7 + j * 13 + k * 5) % 17); return [x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr]; }); return `<path d="${cr(pts)}"/>`; }).join("")}</g>`).join("")}</g>` + folds + seams(tcDD) + rib(crewD, 8, sh(tc, -0.3)),
      tracksuit: baseTop() + folds + `<g clip-path="url(#${u}tor)"><path d="M${CX - SW + 26} 380 C${CX - SW + 30} 450 ${CX - SW + 30} 520 ${CX - SW + 28} 620 M${CX + SW - 26} 380 C${CX + SW - 30} 450 ${CX + SW - 30} 520 ${CX + SW - 28} 620" stroke="${t2}" stroke-width="7" fill="none"/><path d="M${CX - SW + 38} 384 C${CX - SW + 42} 450 ${CX - SW + 42} 520 ${CX - SW + 40} 620 M${CX + SW - 38} 384 C${CX + SW - 42} 450 ${CX + SW - 42} 520 ${CX + SW - 40} 620" stroke="#fff" stroke-width="4" fill="none" opacity=".9"/></g><path d="M${CX - nw - 8} 314 C${CX - nw - 10} 332 ${CX - nw - 10} 346 ${CX - nw - 4} 354 C${CX - 16} 366 ${CX + 16} 366 ${CX + nw + 4} 354 C${CX + nw + 10} 346 ${CX + nw + 10} 332 ${CX + nw + 8} 314 C${CX + 16} 322 ${CX - 16} 322 ${CX - nw - 8} 314Z" fill="url(#${u}tp)" stroke="${tcD}" stroke-width="1.5"/><path d="M${CX} 320 V620" stroke="${tcDD}" stroke-width="4.5" stroke-dasharray="1.5 1.3"/><rect x="${CX - 3.5}" y="352" width="7" height="16" rx="2" fill="url(#${u}mt)"/>${LOGO(CX + 62, 392, 34, ink(tc, t2))}`,
      moneytee: baseTop() + `<g clip-path="url(#${u}tor)">${[[CX - 92, 400, -18], [CX + 70, 392, 14], [CX - 30, 452, 8], [CX + 96, 480, -10], [CX - 110, 510, 20], [CX + 20, 528, -22], [CX + 120, 580, 6], [CX - 60, 590, -8]].map(([x, y, r]) => `<g transform="rotate(${r} ${x} ${y})"><rect x="${x - 34}" y="${y - 16}" width="68" height="32" rx="2" fill="#8FC98A" stroke="#4E8A4A" stroke-width="1.5"/><rect x="${x - 29}" y="${y - 11}" width="58" height="22" rx="2" fill="none" stroke="#4E8A4A" stroke-width="1" opacity=".7"/><ellipse cx="${x}" cy="${y}" rx="9" ry="9" fill="#B9E0B4" stroke="#4E8A4A"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="13" fill="#2F6B2C">$</text><text x="${x - 22}" y="${y - 3}" font-family="Arial" font-weight="800" font-size="7" fill="#2F6B2C">100</text></g>`).join("")}</g>` + folds + rib(crewD, 8, tcD),
    };
    defs = defs.replace("</defs>", `<pattern id="${u}plaid" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(0)"><rect width="40" height="40" fill="${tc}"/><rect width="14" height="40" fill="${t2}" opacity=".55"/><rect width="40" height="14" fill="${t2}" opacity=".55"/><rect x="24" width="3" height="40" fill="${tcDD}" opacity=".6"/><rect y="24" width="40" height="3" fill="${tcDD}" opacity=".6"/><rect x="5" width="1.2" height="40" fill="#fff" opacity=".4"/><rect y="5" width="40" height="1.2" fill="#fff" opacity=".4"/></pattern><pattern id="${u}plaidB" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="40" height="40" fill="${tc}"/><rect width="14" height="40" fill="${t2}" opacity=".55"/><rect width="40" height="14" fill="${t2}" opacity=".55"/><rect x="24" width="3" height="40" fill="${tcDD}" opacity=".6"/></pattern></defs>`);
    defs = defs.replace("</defs>", `<clipPath id="${u}tor"><path d="${torso}"/></clipPath></defs>`);
    let topArt = TOP[c.top] || TOP.tee;
    // jackets
    const panelL = `M${CX - nw - 4} 328 C${CX - nw - 22} 350 ${CX - SW + 44} 360 ${CX - SW + 16} 376 C${CX - SW - 6} 390 ${CX - SW - 14} 440 ${CX - SW - 16} 560 L${CX - 4} 560 L${CX - 4} 470Z`;
    const lapelL = `M${CX - nw - 4} 328 L${CX - nw - 30} 368 L${CX - nw - 16} 380 L${CX - 6} 466 L${CX - nw - 2} 340Z`;
    const panels = (fill) => `<path d="${panelL}" fill="${fill}"/><path d="${mir(panelL)}" fill="${fill}"/>`;
    const OUT = {
      none: "",
      blazer: panels(`url(#${u}ot)`) + cshadow(lapelL + " " + mir(lapelL)) + `<path d="${lapelL}" fill="${ocD}"/><path d="${mir(lapelL)}" fill="${ocD}"/><path d="M${CX - nw - 30} 368 L${CX - 7} 464 M${CX + nw + 30} 368 L${CX + 7} 464" stroke="${sh(oc, 0.25)}" stroke-width="1.6" opacity=".6"/><path d="M${CX - nw - 30} 368 L${CX - nw - 22} 362 L${CX - nw - 16} 380Z M${CX + nw + 30} 368 L${CX + nw + 22} 362 L${CX + nw + 16} 380Z" fill="${sh(oc, -0.45)}"/><path d="M${CX + SW - 98} 432 h36" stroke="${ocD}" stroke-width="5" stroke-linecap="round"/>${stitch(`M${CX - nw - 16} 344 L${CX - 9} 458`, sh(oc, 0.2), 0.35)}${btn(CX - 14, 494, 5.5, sh(oc, -0.35))}<path d="M${CX - SW + 50} 478 h44 M${CX + SW - 94} 478 h44" stroke="${ocD}" stroke-width="4" stroke-linecap="round"/>`,
      suit: panels(`url(#${u}ot)`) + cshadow(lapelL + " " + mir(lapelL)) + `<path d="${lapelL}" fill="${ocD}"/><path d="${mir(lapelL)}" fill="${ocD}"/><path d="M${CX - nw - 30} 368 L${CX - 7} 464 M${CX + nw + 30} 368 L${CX + 7} 464" stroke="${sh(oc, 0.25)}" stroke-width="1.6" opacity=".6"/><path d="M${CX - nw - 30} 368 L${CX - nw - 22} 362 L${CX - nw - 16} 380Z M${CX + nw + 30} 368 L${CX + nw + 22} 362 L${CX + nw + 16} 380Z" fill="${sh(oc, -0.45)}"/><path d="M${CX + SW - 98} 432 h36" stroke="${ocD}" stroke-width="5" stroke-linecap="round"/><path d="M${CX + SW - 94} 431 l8 -10 l7 7 l7 -9 l6 12z" fill="#fff" opacity=".92"/>${btn(CX - 14, 482, 5.5, sh(oc, -0.35))}${btn(CX - 14, 518, 5.5, sh(oc, -0.35))}<path d="M${CX - SW + 50} 486 h44 M${CX + SW - 94} 486 h44" stroke="${ocD}" stroke-width="4" stroke-linecap="round"/>`,
      leather: (() => { const P = panelL.replace(`L${CX - 4} 560 L${CX - 4} 470Z`, `L${CX - 12} 560 L${CX - 16} 420Z`), LP = `M${CX - nw - 4} 328 L${CX - nw - 40} 372 L${CX - nw - 18} 392 L${CX - 16} 420Z`; return `<path d="${P}" fill="#1E1A22"/><path d="${mir(P)}" fill="#1E1A22"/>${cshadow(LP + " " + mir(LP))}<path d="${LP}" fill="#2E2836"/><path d="${mir(LP)}" fill="#2E2836"/><path d="M${CX - 26} 440 V600" stroke="#9FA3AD" stroke-width="5" stroke-dasharray="1.6 1.4"/><rect x="${CX - 29}" y="446" width="6" height="14" rx="2" fill="url(#${u}mt)"/><circle cx="${CX - nw - 30}" cy="376" r="3" fill="url(#${u}mt)"/><circle cx="${CX + nw + 30}" cy="376" r="3" fill="url(#${u}mt)"/><path d="M${CX - SW + 50} 470 h46" stroke="#9FA3AD" stroke-width="4" stroke-dasharray="1.6 1.4"/><g filter="url(#${u}b4)"><path d="M${CX - SW + 24} 398 C${CX - SW + 46} 384 ${CX - 96} 380 ${CX - 76} 378" stroke="#fff" stroke-width="7" fill="none" opacity=".22"/><path d="M${CX - SW + 30} 440 C${CX - SW + 34} 480 ${CX - SW + 34} 520 ${CX - SW + 32} 560" stroke="#fff" stroke-width="6" fill="none" opacity=".12"/><path d="M${CX + SW - 40} 420 C${CX + 110} 404 ${CX + 90} 400 ${CX + 70} 404" stroke="#fff" stroke-width="5" fill="none" opacity=".14"/></g>`; })(),
      bomber: `<path d="${torso}" fill="url(#${u}ot)"/>` + folds + seams(ocD) + rib(`M${CX - nw - 14} 330 C${CX - nw} 368 ${CX + nw} 368 ${CX + nw + 14} 330`, 15, sh(t2, -0.1)) + `<path d="M${CX} 366 V600" stroke="${sh(oc, -0.45)}" stroke-width="5" stroke-dasharray="1.6 1.4"/><path d="M${CX - 5} 366 V600 M${CX + 5} 366 V600" stroke="${ocD}" stroke-width="1.4"/><rect x="${CX - 3.5}" y="380" width="7" height="16" rx="2" fill="url(#${u}mt)"/><rect x="${CX - SW + 46}" y="404" width="34" height="9" rx="3" fill="${ocD}" transform="rotate(18 ${CX - SW + 63} 408)"/><path d="M${CX - SW + 50} 404 l26 8" stroke="url(#${u}mt)" stroke-width="2"/><rect x="${CX + 58}" y="420" width="32" height="8" rx="3" fill="${sh(t2, -0.1)}"/>`,
      denim: (() => { const P = panelL.replace(`L${CX - 4} 560 L${CX - 4} 470Z`, `L${CX - 8} 560 L${CX - 26} 400Z`), CL = `M${CX - nw - 4} 326 L${CX - nw - 26} 358 L${CX - 26} 400 L${CX - nw - 2} 340Z`, gold = "#D9A441"; return `<path d="${P}" fill="#4E73B8"/><path d="${mir(P)}" fill="#4E73B8"/>${cshadow(CL + " " + mir(CL))}<path d="${CL}" fill="#3D5E9C"/><path d="${mir(CL)}" fill="#3D5E9C"/><g fill="#3D5E9C" stroke="#33508A" stroke-width="1"><path d="M${CX - 108} 416 h46 v10 l-23 10 l-23 -10z"/><path d="M${CX + 62} 416 h46 v10 l-23 10 l-23 -10z"/></g>${stitch(`M${CX - 106} 420 h42 M${CX - 106} 424 h42 M${CX + 64} 420 h42 M${CX + 64} 424 h42 M${CX - SW + 30} 404 C${CX - 110} 398 ${CX - 60} 398 ${CX - 30} 404 M${CX + SW - 30} 404 C${CX + 110} 398 ${CX + 60} 398 ${CX + 30} 404 M${CX - 30} 404 L${CX - 12} 560 M${CX + 30} 404 L${CX + 12} 560`, gold, 0.75)}${btn(CX - 85, 430, 3.6, "#B8863B")}${btn(CX + 85, 430, 3.6, "#B8863B")}${[430, 480, 530].map((y) => btn(CX - 20 + (y - 430) * 0.05, y, 4.2, "#B8863B")).join("")}`; })(),
      varsity: `<path d="${panelL}" fill="url(#${u}ot)"/><path d="${mir(panelL)}" fill="url(#${u}ot)"/><g clip-path="url(#${u}tor)"><path d="M0 380 L${CX - SW + 48} 392 C${CX - SW + 52} 450 ${CX - SW + 50} 500 ${CX - SW + 48} 560 L0 560Z M400 380 L${CX + SW - 48} 392 C${CX + SW - 52} 450 ${CX + SW - 50} 500 ${CX + SW - 48} 560 L400 560Z" fill="${t2}"/></g>` + rib(`M${CX - nw - 10} 328 L${CX - 6} 470`, 9, sh(t2, -0.05)) + rib(`M${CX + nw + 10} 328 L${CX + 6} 470`, 9, sh(t2, -0.05)) + `<path d="M${CX - nw - 12} 328 L${CX - 8} 470 M${CX + nw + 12} 328 L${CX + 8} 470" stroke="${oc}" stroke-width="1.6" opacity=".7"/>${[400, 440, 480, 520].map((y) => `<circle cx="${CX - 14}" cy="${y}" r="4.4" fill="url(#${u}mt)"/><circle cx="${CX - 15.5}" cy="${y - 1.5}" r="1.4" fill="#fff" opacity=".8"/>`).join("")}${LOGO(CX - 70, 404, 50, ink(oc, t2))}`,
      vest: `<path d="${panelL.replace(`C${CX - SW - 6} 390 ${CX - SW - 14} 440 ${CX - SW - 16} 560`, `C${CX - SW + 30} 420 ${CX - SW + 40} 480 ${CX - SW + 42} 560`)}" fill="url(#${u}ot)"/><path d="${mir(panelL.replace(`C${CX - SW - 6} 390 ${CX - SW - 14} 440 ${CX - SW - 16} 560`, `C${CX - SW + 30} 420 ${CX - SW + 40} 480 ${CX - SW + 42} 560`))}" fill="url(#${u}ot)"/><g clip-path="url(#${u}tor)" stroke="${ocD}" stroke-width="3" opacity=".7">${[410, 450, 490, 530].map((y) => `<path d="M${CX - SW + 30} ${y} C${CX - 90} ${y + 6} ${CX - 40} ${y + 6} ${CX - 6} ${y}"/><path d="M${CX + SW - 30} ${y} C${CX + 90} ${y + 6} ${CX + 40} ${y + 6} ${CX + 6} ${y}"/>`).join("")}</g><path d="M${CX - nw - 10} 326 C${CX - nw - 4} 346 ${CX - 30} 356 ${CX - 6} 360 M${CX + nw + 10} 326 C${CX + nw + 4} 346 ${CX + 30} 356 ${CX + 6} 360" stroke="${ocD}" stroke-width="8" fill="none"/>`,
      cardigan: (() => { const P = panelL.replace(`L${CX - 4} 560 L${CX - 4} 470Z`, `L${CX - 10} 560 L${CX - 20} 380Z`); return `<path d="${P}" fill="url(#${u}ot)"/><path d="${mir(P)}" fill="url(#${u}ot)"/>` + rib(`M${CX - nw - 6} 328 L${CX - 20} 380 L${CX - 10} 600`, 9, ocD) + rib(`M${CX + nw + 6} 328 L${CX + 20} 380 L${CX + 10} 600`, 9, ocD) + [420, 460, 500, 540].map((y) => btn(CX - 22 + (y - 420) * 0.08, y, 4, sh(oc, -0.4))).join(""); })(),
      puffer: (() => { const ys = [356, 394, 432, 470, 508, 546, 584, 622]; const xo = (y) => SW + 22 + Math.min(10, (y - 356) * 0.12); let lp = `M${CX - nw - 14} 318 C${CX - nw - 40} 336 ${CX - SW + 20} 344 ${CX - SW - 4} ${ys[0]}`; for (let k = 0; k < ys.length - 1; k++) { const y0 = ys[k], y1 = ys[k + 1], x = xo(y0); lp += ` Q${CX - x - 12} ${(y0 + y1) / 2} ${CX - x + 2} ${y1}`; } const rp = lp.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${(2 * CX - +x).toFixed(1)} ${y}`); const P = `${lp} L${CX} 640 L${CX} 300Z ${rp} L${CX} 640 L${CX} 300Z`; const id = `${u}pfc`; const base = oc; return `<defs><clipPath id="${id}"><path d="${P}"/></clipPath><linearGradient id="${u}pfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(base, -0.35)}"/><stop offset=".22" stop-color="${sh(base, 0.22)}"/><stop offset=".55" stop-color="${sh(base, 0.04)}"/><stop offset="1" stop-color="${sh(base, -0.42)}"/></linearGradient><linearGradient id="${u}pfs" gradientUnits="userSpaceOnUse" x1="${CX - SW - 40}" y1="0" x2="${CX + SW + 40}" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".38" stop-color="#fff" stop-opacity=".12"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs><path d="${P}" fill="${sh(base, -0.3)}"/><g clip-path="url(#${id})">${ys.slice(0, -1).map((y, k) => `<rect x="0" y="${y - 1}" width="400" height="${ys[k + 1] - y + 2}" fill="url(#${u}pfg)"/><ellipse cx="${CX - 60}" cy="${y + 11}" rx="70" ry="5" fill="#fff" opacity="${lum(base) < 0.2 ? 0.16 : 0.22}" filter="url(#${u}b4)"/><ellipse cx="${CX + 70}" cy="${y + 12}" rx="50" ry="4" fill="#fff" opacity=".1" filter="url(#${u}b4)"/>`).join("")}<rect x="0" y="300" width="400" height="340" fill="url(#${u}pfs)"/><g stroke="${sh(base, -0.55)}" stroke-width="1" stroke-dasharray="2.4 2" opacity=".55">${ys.map((y) => `<path d="M0 ${y + 1} H400"/>`).join("")}</g></g><path d="M${CX - nw - 18} 292 C${CX - nw - 22} 328 ${CX - nw - 18} 350 ${CX - nw - 6} 362 C${CX - 20} 374 ${CX + 20} 374 ${CX + nw + 6} 362 C${CX + nw + 18} 350 ${CX + nw + 22} 328 ${CX + nw + 18} 292 C${CX + 20} 306 ${CX - 20} 306 ${CX - nw - 18} 292Z" fill="${sh(base, 0.02)}"/><path d="M${CX - nw - 18} 292 C${CX - nw - 22} 328 ${CX - nw - 18} 350 ${CX - nw - 6} 362 C${CX - 20} 374 ${CX + 20} 374 ${CX + nw + 6} 362 C${CX + nw + 18} 350 ${CX + nw + 22} 328 ${CX + nw + 18} 292" fill="none" stroke="#000" stroke-width="8" opacity=".25" filter="url(#${u}b4)"/><path d="M${CX - nw - 16} 296 C${CX - 20} 308 ${CX + 20} 308 ${CX + nw + 16} 296" stroke="#fff" stroke-width="3" opacity=".3" fill="none"/><path d="M${CX} 304 V640" stroke="${sh(base, -0.6)}" stroke-width="7" stroke-dasharray="1.6 1.4"/><path d="M${CX - 4} 304 V640 M${CX + 4} 304 V640" stroke="${sh(base, -0.45)}" stroke-width="1.5"/><rect x="${CX - 4}" y="328" width="8" height="22" rx="2.5" fill="url(#${u}mt)"/><path d="M${CX} 350 v10" stroke="url(#${u}mt)" stroke-width="2"/><rect x="${CX + 52}" y="400" width="40" height="17" rx="3" fill="${t2}"/>${LOGO(CX + 72, 401, 22, ink(t2, "#FFFFFF"))}`; })(),
      furcoat: (() => { const P = panelL.replace(`L${CX - 4} 560 L${CX - 4} 470Z`, `L${CX - 14} 560 L${CX - 24} 380Z`); const fur = sh(oc, 0.1), furD = sh(oc, -0.3), furL = mix(sh(oc, 0.35), "#FFFFFF", 0.2); const spine = (x0, y0, x1, y1, x2, y2) => (t) => { const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c2 = t * t; return [a * x0 + b * x1 + c2 * x2, a * y0 + b * y1 + c2 * y2]; }; const SL = spine(CX - nw - 40, 316, CX - 70, 372, CX - 26, 620); let sd = "", sm = "", sl = ""; let rr = 11; for (let i = 0; i < 520; i++) { rr = (rr * 9301 + 49297) % 233280; const t = (i / 520), q = SL(t), r1 = rr / 233280, w = 26 - t * 8; const x = q[0] + (r1 - 0.5) * w * 2, y = q[1] + ((i * 37) % 11) - 5; const ang = (r1 - 0.5) * 1.6 + (x < q[0] ? -0.6 : 0.6), L = 6 + ((i * 13) % 7); const seg = `M${x.toFixed(1)} ${y.toFixed(1)}q${(Math.sin(ang) * L * 0.5 + 2).toFixed(1)} ${(Math.cos(ang) * L * 0.5).toFixed(1)} ${(Math.sin(ang) * L).toFixed(1)} ${(Math.cos(ang) * L).toFixed(1)}`; if (i % 3 === 0) sd += seg; else if (i % 3 === 1) sm += seg; else sl += seg; } const mirD = (d) => d.replace(/M(-?[\d.]+) /g, (m, x) => `M${(2 * CX - +x).toFixed(1)} `).replace(/q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g, (m, a, b, c3, d2) => `q${-a} ${b} ${-c3} ${d2}`); const band = (d) => `<path d="${d}" fill="none" stroke="${furD}" stroke-width="5" stroke-linecap="round" opacity=".9"/>`; const coll = `M${CX - nw - 40} 316 Q${CX - 70} 372 ${CX - 26} 620`; return `<path d="${P}" fill="url(#${u}ot)"/><path d="${mir(P)}" fill="url(#${u}ot)"/><g clip-path="url(#${u}oc)"><rect x="0" y="300" width="400" height="320" filter="url(#${u}knit)" opacity=".45" style="mix-blend-mode:soft-light"/></g><path d="${coll} ${mir(coll)}" stroke="#000" stroke-width="54" opacity=".3" fill="none" filter="url(#${u}b8)" transform="translate(0 6)"/><path d="${coll} ${mir(coll)}" stroke="${fur}" stroke-width="40" fill="none" stroke-linecap="round" filter="url(#${u}b2)"/><g filter="url(#${u}b1)">${band(sd + mirD(sd))}<path d="${sm}${mirD(sm)}" fill="none" stroke="${fur}" stroke-width="4.5" stroke-linecap="round"/><path d="${sl}${mirD(sl)}" fill="none" stroke="${furL}" stroke-width="3" stroke-linecap="round" opacity=".85"/></g><path d="${coll} ${mir(coll)}" stroke="#fff" stroke-width="14" opacity=".12" fill="none" filter="url(#${u}b8)" transform="translate(-6 -6)"/>`; })(),
    };
    const outerArt = OUT[c.outer] || "";
    // neckwear
    const NECK = {
      none: "",
      tie: `<path d="M${CX - 12} 352 L${CX + 12} 352 L${CX + 8} 370 L${CX - 8} 370Z" fill="${sh(t2, -0.15)}"/><path d="M${CX - 8} 368 L${CX + 8} 368 L${CX + 16} 470 L${CX} 492 L${CX - 16} 470Z" fill="${t2}"/><path d="M${CX - 4} 390 l10 -6 M${CX - 8} 420 l16 -9 M${CX - 10} 452 l18 -10" stroke="${sh(t2, -0.25)}" stroke-width="3"/>`,
      bowtie: `<path d="M${CX - 30} 340 L${CX - 4} 352 L${CX - 30} 366Z M${CX + 30} 340 L${CX + 4} 352 L${CX + 30} 366Z" fill="${t2}" stroke="${sh(t2, -0.3)}" stroke-width="2" stroke-linejoin="round"/><rect x="${CX - 7}" y="345" width="14" height="14" rx="4" fill="${sh(t2, -0.2)}"/>`,
      chain: `<path d="M${CX - nw - 2} 334 C${CX - 30} 392 ${CX + 30} 392 ${CX + nw + 2} 334" stroke="url(#${u}mt)" stroke-width="5" fill="none" stroke-dasharray="6 2.5"/>`,
      pendant: `<path d="M${CX - nw} 334 C${CX - 26} 386 ${CX + 26} 386 ${CX + nw} 334" stroke="url(#${u}mt)" stroke-width="2.5" fill="none"/><path d="M${CX} 382 l10 12 l-10 12 l-10 -12z" fill="url(#${u}mt)"/>`,
      pearls: `<g fill="#F7F3EA" stroke="#D9D2C2" stroke-width="1">${Array.from({ length: 15 }, (_, i) => { const t = i / 14, a = Math.PI * (1 - t); return `<circle cx="${(CX + Math.cos(a) * (nw + 6)).toFixed(1)}" cy="${(334 + Math.sin(a) * 44).toFixed(1)}" r="5"/>`; }).join("")}</g>`,
      cuban: `<path d="M${CX - nw - 4} 332 C${CX - 34} 398 ${CX + 34} 398 ${CX + nw + 4} 332" stroke="#000" stroke-width="12" fill="none" opacity=".3" filter="url(#${u}b2)" transform="translate(0 3)"/><path d="M${CX - nw - 4} 332 C${CX - 34} 398 ${CX + 34} 398 ${CX + nw + 4} 332" stroke="url(#${u}mt)" stroke-width="11" fill="none"/><path d="M${CX - nw - 4} 332 C${CX - 34} 398 ${CX + 34} 398 ${CX + nw + 4} 332" stroke="#000" stroke-width="11" fill="none" stroke-dasharray="1.4 6.2" opacity=".45"/><path d="M${CX - nw - 4} 330 C${CX - 34} 396 ${CX + 34} 396 ${CX + nw + 4} 330" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="3 4.6" opacity=".7"/>`,
      hppiece: `<path d="M${CX - nw} 334 C${CX - 26} 380 ${CX + 26} 380 ${CX + nw} 334" stroke="url(#${u}mt)" stroke-width="4" fill="none" stroke-dasharray="4 1.6"/><circle cx="${CX}" cy="404" r="31" fill="#000" opacity=".3" filter="url(#${u}b4)" transform="translate(0 4)"/><circle cx="${CX}" cy="402" r="30" fill="url(#${u}mt)"/><circle cx="${CX}" cy="402" r="23" fill="#121318"/>${LOGO(CX, 386, 33, (METAL[c.metal] || METAL.gold)[0], "#FFFFFF")}<g fill="#fff">${Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<circle cx="${(CX + Math.cos(a) * 26.5).toFixed(1)}" cy="${(402 + Math.sin(a) * 26.5).toFixed(1)}" r="2.2" opacity="${i % 3 ? 0.85 : 1}"/>`; }).join("")}</g><path d="M${CX - 20} 376 l3 -8 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3z M${CX + 26} 420 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2z" fill="#fff"/>`,
      bandana: `<path d="M${CX - nw - 12} 330 C${CX - 20} 352 ${CX + 20} 352 ${CX + nw + 12} 330 L${CX + 26} 352 L${CX} 410 L${CX - 26} 352Z" fill="${t2}"/><path d="M${CX - nw - 12} 330 C${CX - 20} 352 ${CX + 20} 352 ${CX + nw + 12} 330 L${CX + 26} 352 L${CX} 410 L${CX - 26} 352Z" fill="url(#${u}pais)"/><path d="M${CX - nw - 14} 326 C${CX - 20} 350 ${CX + 20} 350 ${CX + nw + 14} 326" stroke="${sh(t2, -0.3)}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M${CX - 22} 360 L${CX} 404 L${CX + 22} 360" stroke="${sh(t2, -0.3)}" stroke-width="2" fill="none" opacity=".5"/>`,
      lanyard: `<path d="M${CX - nw - 4} 330 L${CX - 10} 448 M${CX + nw + 4} 330 L${CX + 10} 448" stroke="${t2}" stroke-width="7"/><rect x="${CX - 30}" y="446" width="60" height="78" rx="8" fill="#fff" stroke="#D5D9E2" stroke-width="2"/><rect x="${CX - 30}" y="446" width="60" height="22" rx="8" fill="${t2}"/>${LOGO(CX, 449, 23, ink(t2, "#FFFFFF"))}<circle cx="${CX}" cy="490" r="12" fill="#E3E6EE"/><rect x="${CX - 18}" y="506" width="36" height="5" rx="2.5" fill="#E3E6EE"/>`,
    };
    const neckArt = NECK[c.neck] || "";
    const neckUnder = ["tie", "bowtie"].includes(c.neck);
    defs = defs.replace("</defs>", `<pattern id="${u}pais" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.2" fill="none" stroke="#fff" stroke-width="1.1" opacity=".85"/><circle cx="12" cy="12" r="1.2" fill="#fff" opacity=".8"/><path d="M10 3 q3 1 2 4" stroke="#fff" stroke-width="1" fill="none" opacity=".7"/></pattern></defs>`);

    /* ---- head pieces ---- */
    const ears = (() => {
      const r = 15 * G.ears, ry = 25 * G.ears, ex = hw - 3, ey = 212;
      const one = (s) => `<ellipse cx="${CX + s * ex}" cy="${ey}" rx="${r}" ry="${ry}" fill="url(#${u}er)"/><path d="M${CX + s * (ex + r * 0.1)} ${ey - ry * 0.55} C${CX + s * (ex + r * 0.7)} ${ey - ry * 0.45} ${CX + s * (ex + r * 0.65)} ${ey + ry * 0.35} ${CX + s * (ex + r * 0.1)} ${ey + ry * 0.45}" stroke="${skDD}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55" filter="url(#${u}b2)"/><ellipse cx="${CX + s * (ex + r * 0.3)}" cy="${ey - ry * 0.35}" rx="${r * 0.3}" ry="${ry * 0.22}" fill="#fff" opacity=".18" filter="url(#${u}b2)"/>`;
      return one(-1) + one(1);
    })();
    const earrings = (() => {
      const ex = hw - 1 + 2, ey = 236, m = `url(#${u}mt)`;
      const one = (s) => ({ studs: `<circle cx="${CX + s * ex}" cy="${ey}" r="4.5" fill="${m}"/>`, hoops: `<circle cx="${CX + s * ex}" cy="${ey + 12}" r="12" fill="none" stroke="${m}" stroke-width="3.5"/>`, drops: `<path d="M${CX + s * ex} ${ey} v10" stroke="${m}" stroke-width="2.5"/><path d="M${CX + s * ex} ${ey + 10} l7 11 l-7 11 l-7 -11z" fill="${m}"/>` }[c.earrings] || "");
      return one(-1) + one(1);
    })();
    const neckD = `M${CX - nw} 250 L${CX - nw} 330 C${CX - nw + 10} 352 ${CX + nw - 10} 352 ${CX + nw} 330 L${CX + nw} 250Z`;
    const neck = `<path d="${neckD}" fill="url(#${u}nk)"/><g clip-path="url(#${u}nkc)"><ellipse cx="${CX}" cy="${chinY - 14}" rx="${jw + 10}" ry="40" fill="${skDD}" opacity=".55" filter="url(#${u}b8)"/><rect x="${CX + nw - 14}" y="240" width="20" height="120" fill="${skDD}" opacity=".35" filter="url(#${u}b4)"/></g>`;
    const faceShade = `<g clip-path="url(#${u}fc)"><rect x="0" y="0" width="400" height="400" fill="url(#${u}side)" opacity=".6"/>
<path d="${FP}" fill="none" stroke="${skDD}" stroke-width="40" opacity=".62" filter="url(#${u}b14)"/>
<ellipse cx="${CX - 26}" cy="150" rx="62" ry="76" fill="${skL}" opacity=".55" filter="url(#${u}b14)"/>
<ellipse cx="${CX - 14}" cy="116" rx="36" ry="14" fill="#fff" opacity=".17" filter="url(#${u}b8)"/>
<ellipse cx="${CX - gap}" cy="${eyeY - 9}" rx="30" ry="18" fill="${skDD}" opacity=".26" filter="url(#${u}b8)"/>
<ellipse cx="${CX + gap}" cy="${eyeY - 9}" rx="30" ry="18" fill="${skDD}" opacity=".32" filter="url(#${u}b8)"/>
<ellipse cx="${CX - gap - 8}" cy="${eyeY + 34}" rx="22" ry="12" fill="#fff" opacity=".14" filter="url(#${u}b8)"/>
<ellipse cx="${CX + gap + 8}" cy="${eyeY + 34}" rx="22" ry="12" fill="#fff" opacity=".08" filter="url(#${u}b8)"/>
<ellipse cx="${CX}" cy="${(G.mouthY + 21).toFixed(1)}" rx="16" ry="6" fill="${skDD}" opacity=".32" filter="url(#${u}b4)"/><path d="M${CX - 5} ${(G.noseY + 9).toFixed(1)} L${CX - 6} ${(G.mouthY - 8).toFixed(1)} M${CX + 5} ${(G.noseY + 9).toFixed(1)} L${CX + 6} ${(G.mouthY - 8).toFixed(1)}" stroke="${skDD}" stroke-width="2.4" opacity=".22" filter="url(#${u}b1)"/><path d="M${CX - 26} ${(G.noseY - 2).toFixed(1)} C${CX - 36} ${(G.noseY + 12).toFixed(1)} ${CX - 38} ${(G.mouthY - 6).toFixed(1)} ${CX - 33} ${(G.mouthY + 4).toFixed(1)} M${CX + 26} ${(G.noseY - 2).toFixed(1)} C${CX + 36} ${(G.noseY + 12).toFixed(1)} ${CX + 38} ${(G.mouthY - 6).toFixed(1)} ${CX + 33} ${(G.mouthY + 4).toFixed(1)}" stroke="${skDD}" stroke-width="5" fill="none" opacity=".2" filter="url(#${u}b2)"/><ellipse cx="${CX - hw + 22}" cy="${eyeY + 46}" rx="18" ry="30" fill="${skDD}" opacity=".18" filter="url(#${u}b8)" transform="rotate(-18 ${CX - hw + 22} ${eyeY + 46})"/><ellipse cx="${CX + hw - 22}" cy="${eyeY + 46}" rx="18" ry="30" fill="${skDD}" opacity=".24" filter="url(#${u}b8)" transform="rotate(18 ${CX + hw - 22} ${eyeY + 46})"/><ellipse cx="${CX - gap - 4}" cy="${eyeY + 26}" rx="26" ry="8" fill="${skL}" opacity=".35" filter="url(#${u}b4)"/><ellipse cx="${CX + gap + 4}" cy="${eyeY + 26}" rx="26" ry="8" fill="${skL}" opacity=".2" filter="url(#${u}b4)"/>
<ellipse cx="${CX - 4}" cy="${chinY - 14}" rx="17" ry="9" fill="#fff" opacity=".15" filter="url(#${u}b4)"/>
<ellipse cx="${CX + hw - 4}" cy="200" rx="5" ry="64" fill="#fff" opacity=".13" filter="url(#${u}b4)"/></g>`;
    const blushArt = c.blush > 0 ? `<ellipse cx="${CX - gap - 14}" cy="${eyeY + 40}" rx="22" ry="13" fill="url(#${u}bl)" opacity="${(0.15 + c.blush * 0.6).toFixed(2)}"/><ellipse cx="${CX + gap + 14}" cy="${eyeY + 40}" rx="22" ry="13" fill="url(#${u}bl)" opacity="${(0.15 + c.blush * 0.6).toFixed(2)}"/>` : "";
    const freckleArt = c.freckles > 0 ? `<g fill="${skLine}" opacity="${(0.25 + c.freckles * 0.45).toFixed(2)}">${[[-58, 234], [-48, 228], [-40, 238], [-30, 230], [-52, 242], [-22, 238], [58, 234], [48, 228], [40, 238], [30, 230], [52, 242], [22, 238], [-8, 230], [8, 232], [0, 226]].map(([dx, y]) => `<circle cx="${CX + dx}" cy="${y + (eyeY - 200)}" r="${1.6 + (Math.abs(dx) % 3) * 0.3}"/>`).join("")}</g>` : "";
    const moleArt = { cheek: `<circle cx="${CX + 52}" cy="${eyeY + 50}" r="3" fill="${sh(sk, -0.55)}"/>`, lip: `<circle cx="${CX - 24}" cy="${G.mouthY - 14}" r="2.8" fill="${sh(sk, -0.55)}"/>`, eye: `<circle cx="${CX + gap + 18}" cy="${eyeY + 18}" r="2.6" fill="${sh(sk, -0.55)}"/>` }[c.mole] || "";
    const ageArt = c.age > 0 ? `<g stroke="${skLine}" stroke-width="2" fill="none" stroke-linecap="round" opacity="${(0.15 + c.age * 0.45).toFixed(2)}"><path d="M${CX - 40} 138 C${CX - 14} 132 ${CX + 14} 132 ${CX + 40} 138"/><path d="M${CX - 30} 150 C${CX - 10} 146 ${CX + 10} 146 ${CX + 30} 150"/><path d="M${CX - 30} ${G.noseY + 4} C${CX - 40} ${G.noseY + 14} ${CX - 40} ${G.mouthY - 2} ${CX - 34} ${G.mouthY + 6}"/><path d="M${CX + 30} ${G.noseY + 4} C${CX + 40} ${G.noseY + 14} ${CX + 40} ${G.mouthY - 2} ${CX + 34} ${G.mouthY + 6}"/><path d="M${CX - gap - 26} ${eyeY + 2} l-8 -4 M${CX - gap - 26} ${eyeY + 6} l-8 2 M${CX + gap + 26} ${eyeY + 2} l8 -4 M${CX + gap + 26} ${eyeY + 6} l8 2"/></g>` : "";

    /* eyes: shapes drawn for the right eye (outer corner at +x), mirrored for the left */
    const ES = {
      almond: ["M-23 2 C-15 -13 9 -16 24 -3", "C15 10 -8 12 -23 2"], round: ["M-21 0 C-20 -15 20 -15 21 0", "C20 13 -20 13 -21 0"], wide: ["M-23 0 C-22 -18 22 -18 23 0", "C22 16 -22 16 -23 0"],
      hooded: ["M-23 1 C-13 -9 11 -11 24 -2", "C15 10 -8 11 -23 1"], monolid: ["M-23 1 C-11 -8 12 -9 24 -1", "C14 7 -8 8 -23 1"], upturned: ["M-23 4 C-15 -10 9 -17 24 -7", "C18 8 -6 12 -23 4"],
      downturned: ["M-24 -3 C-12 -15 13 -13 23 4", "C12 11 -10 9 -24 -3"], sleepy: ["M-23 1 C-12 -6 12 -7 24 0", "C15 10 -8 11 -23 1"],
    };
    const [eTop, eBot] = ES[c.eyes] || ES.almond;
    const scl = `${eTop} ${eBot}Z`;
    const irisR = { wide: 11.6, round: 11.2, monolid: 10, sleepy: 10.4 }[c.eyes] || 10.8;
    const irisY = { sleepy: 2, hooded: 1, monolid: 1 }[c.eyes] || 0;
    const ic = okHex(c.eyeColor) ? c.eyeColor : DEF.eyeColor;
    defs = defs.replace("</defs>", `<clipPath id="${u}ey"><path d="${scl}"/></clipPath><radialGradient id="${u}ir" cx=".5" cy=".45" r=".55"><stop offset="0" stop-color="${sh(ic, 0.35)}"/><stop offset=".7" stop-color="${ic}"/><stop offset="1" stop-color="${sh(ic, -0.45)}"/></radialGradient></defs>`);
    const shadowA = Math.max(0, Math.min(1, +c.shadowA || 0));
    const eye = (s) => {
      const x = CX + s * gap, rot = s * -G.tilt;
      const inner = `${shadowA > 0 ? `<path d="${eTop} C18 -26 -16 -30 -24 2Z" fill="${okHex(c.shadowColor) ? c.shadowColor : "#B15CFF"}" opacity="${(shadowA * 0.65).toFixed(2)}"/>` : ""}
<path d="${eTop.replace(/^M(-?\d+) (-?\d+)/, (m, a, b) => `M${a} ${+b - 8}`).replace(/C(-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)/, (m, a, b, cc, d, e, f) => `C${a} ${+b - 8} ${cc} ${+d - 8} ${e} ${+f - 7}`)}" fill="none" stroke="${skDD}" stroke-width="2.2" opacity="${c.eyes === "monolid" ? 0 : 0.45}" stroke-linecap="round"/>
<ellipse cx="0" cy="-13" rx="24" ry="7" fill="${skL}" opacity=".35" filter="url(#${u}b2)"/><path d="${scl}" fill="url(#${u}sc)"/><ellipse cx="-20.5" cy="1.2" rx="3" ry="2.4" fill="#E9A2A6" opacity=".75"/>
<g clip-path="url(#${u}ey)"><circle cx="1" cy="${1 + irisY}" r="${irisR}" fill="url(#${u}ir)"/><g stroke="${sh(ic, 0.45)}" stroke-width=".7" opacity=".45">${Array.from({ length: 18 }, (_, k) => { const a = (k / 18) * Math.PI * 2; return `<path d="M${(1 + Math.cos(a) * irisR * 0.42).toFixed(2)} ${(1 + irisY + Math.sin(a) * irisR * 0.42).toFixed(2)}L${(1 + Math.cos(a) * irisR * 0.9).toFixed(2)} ${(1 + irisY + Math.sin(a) * irisR * 0.9).toFixed(2)}"/>`; }).join("")}</g><circle cx="1" cy="${1 + irisY}" r="${irisR - 0.6}" fill="none" stroke="${sh(ic, -0.6)}" stroke-width="1.6" opacity=".85"/><circle cx="1" cy="${1 + irisY}" r="${(irisR * 0.38).toFixed(2)}" fill="#0C0B10"/><path d="M-26 -18 C-10 -10 10 -10 26 -18 L26 -4 C10 2 -10 2 -26 -4Z" fill="#000" opacity=".16" filter="url(#${u}b2)"/><path d="${eTop} L24 -30 L-24 -30Z" fill="${skDD}" opacity=".18" transform="translate(0 4)"/>${c.eyes === "sleepy" || c.eyes === "hooded" ? `<path d="${eTop} L24 -30 L-24 -30Z" fill="${sk}" transform="translate(0 ${c.eyes === "sleepy" ? 5 : 3})"/>` : ""}</g>
<path d="${eTop}" fill="none" stroke="#24160F" stroke-width="${c.lashes === "full" ? 4.2 : c.lashes === "natural" ? 3.7 : 2.6}" stroke-linecap="round"/><path d="M14 -9.5 l2.4 -2.6 M18.6 -7 l3 -2 M22 -4 l3.2 -1" stroke="#24160F" stroke-width="1.1" stroke-linecap="round" opacity=".7"/><path d="${eTop}" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" opacity=".12" filter="url(#${u}b2)" transform="translate(0 2)"/>
<path d="${eBot.replace(/^C/, "M24 -3 C")}" fill="none" stroke="${skLine}" stroke-width="1.4" opacity=".4"/><path d="M-20 9 C-8 15 8 15 21 7" fill="none" stroke="${skDD}" stroke-width="2" opacity=".28" filter="url(#${u}b1)"/><path d="M-21 13 C-8 19 9 18 20 12" fill="none" stroke="${skL}" stroke-width="2" opacity=".25" filter="url(#${u}b1)"/>
${c.lashes === "full" ? `<path d="M15 -11 l3 -5 M19.5 -8 l4.5 -4 M23 -4.5 l5.5 -2" stroke="#24160F" stroke-width="2.2" stroke-linecap="round"/>` : c.lashes === "natural" ? `<path d="M20 -7.5 l4 -3.5 M23.5 -3.5 l5 -1.5" stroke="#24160F" stroke-width="1.8" stroke-linecap="round"/>` : ""}
${c.liner === "wing" ? `<path d="M18 -8 L34 -15 L24 -2Z" fill="#14100E"/>` : c.liner === "thin" ? `<path d="${eTop}" fill="none" stroke="#14100E" stroke-width="5.4" stroke-linecap="round" opacity=".55"/>` : ""}`;
      return `<g transform="translate(${x.toFixed(1)} ${eyeY.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${(s * es).toFixed(3)} ${es.toFixed(3)})">${inner}</g>`
        + `<g transform="translate(${x.toFixed(1)} ${eyeY.toFixed(1)}) scale(${es.toFixed(3)})"><circle cx="${4.2}" cy="${-3.4 + irisY}" r="2.2" fill="#fff" opacity=".95"/><circle cx="${-2.6}" cy="${4.6 + irisY}" r="1" fill="#fff" opacity=".55"/><path d="M-8 7.5 C-3 10 4 10 9 7" stroke="#fff" stroke-width="1.6" fill="none" opacity=".35" stroke-linecap="round" filter="url(#${u}b05)"/></g>`;
    };
    const eyesArt = eye(-1) + eye(1);

    // brows: [inner, peak, outer, inner thickness, outer thickness]
    const BR = { soft: [[-21, 1], [5, -5], [27, 2], 7.5, 3.2], straight: [[-21, 0], [4, -2], [27, -1], 7.5, 4.2], arched: [[-20, 2], [8, -10], [27, 3], 6.5, 2.6], angled: [[-21, 2], [11, -9], [27, 1], 7, 3], thick: [[-22, 0], [4, -5], [27, 1], 11.5, 6], thin: [[-19, 0], [5, -6], [25, 1], 3.6, 2], bushy: [[-22, 1], [4, -5], [28, 2], 12, 7], rounded: [[-21, 0], [1, -6], [25, 3], 8.5, 5] };
    const [bi, bp, bo, t0, t1] = BR[c.brows] || BR.soft;
    const ti = t0 * G.browW, to = t1 * G.browW;
    const browPath = c.brows === "angled"
      ? `M${bi[0]} ${bi[1] - ti / 2} L${bp[0]} ${bp[1] - (ti + to) / 2.6} L${bo[0]} ${bo[1] - to / 2} Q${bo[0] + 3} ${bo[1]} ${bo[0]} ${bo[1] + to / 2} L${bp[0]} ${bp[1] + (ti + to) / 4} L${bi[0]} ${bi[1] + ti / 2} Q${bi[0] - 3} ${bi[1]} ${bi[0]} ${bi[1] - ti / 2}Z`
      : `M${bi[0]} ${bi[1] - ti / 2} Q${bp[0]} ${bp[1] - (ti + to) / 1.7} ${bo[0]} ${bo[1] - to / 2} Q${bo[0] + 3} ${bo[1]} ${bo[0]} ${bo[1] + to / 2} Q${bp[0]} ${bp[1] + (ti + to) / 5} ${bi[0]} ${bi[1] + ti / 2} Q${bi[0] - 3} ${bi[1]} ${bi[0]} ${bi[1] - ti / 2}Z`;
    const brow = (s) => `<g transform="translate(${(CX + s * gap).toFixed(1)} ${G.browY.toFixed(1)}) scale(${s} 1)"><path d="${browPath}" fill="url(#${u}bw)" stroke="${brc}" stroke-width=".8" stroke-linejoin="round" filter="url(#${u}b05)"/><path d="M-14 -1 l4 -3 M-6 -3 l4 -3 M2 -4 l4 -2 M10 -3 l4 -2" stroke="${sh(brc, 0.3)}" stroke-width="1" stroke-linecap="round" opacity=".35"/>${c.brows === "bushy" ? `<path d="M-16 -2 l3 -5 M-8 -4 l3 -6 M2 -6 l3 -5 M12 -5 l3 -5" stroke="${sh(brc, -0.2)}" stroke-width="1.6" stroke-linecap="round"/>` : ""}</g>`;
    const browsArt = brow(-1) + brow(1);

    // nose (bottom of the nose at y=0)
    const nl = mix(skLine, sk, 0.25);
    const NS = {
      button: `<ellipse cx="0" cy="-7" rx="7" ry="6" fill="${skL}" opacity=".55"/><path d="M-11 -3 C-15 4 -8 8 -4 5 M11 -3 C15 4 8 8 4 5" stroke="${nl}" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="5" rx="9" ry="3" fill="${skDD}" opacity=".22"/>`,
      straight: `<path d="M3 -44 C2 -28 6 -14 9 -6" stroke="${nl}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".55"/><path d="M-10 -2 C-13 4 -7 8 -3 5 M10 -2 C13 4 7 8 3 5" stroke="${nl}" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="-1" cy="-6" rx="5" ry="4" fill="${skL}" opacity=".5"/>`,
      small: `<path d="M-7 -1 C-9 4 -5 6 -2 4 M7 -1 C9 4 5 6 2 4" stroke="${nl}" stroke-width="1.9" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="-5" rx="5" ry="4" fill="${skL}" opacity=".55"/>`,
      wide: `<path d="M-16 -4 C-20 5 -11 9 -5 6 M16 -4 C20 5 11 9 5 6" stroke="${nl}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M-8 -1 C-4 2 4 2 8 -1" stroke="${nl}" stroke-width="1.6" fill="none" opacity=".4"/><ellipse cx="0" cy="-7" rx="9" ry="6" fill="${skL}" opacity=".45"/>`,
      roman: `<path d="M2 -46 C6 -34 4 -26 9 -16 C12 -10 10 -4 6 0" stroke="${nl}" stroke-width="2.3" fill="none" stroke-linecap="round" opacity=".6"/><path d="M-10 -1 C-13 5 -7 9 -3 6 M10 -1 C13 5 7 9 3 6" stroke="${nl}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      broad: `<path d="M-17 -6 C-23 4 -14 10 -6 7 M17 -6 C23 4 14 10 6 7" stroke="${nl}" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="0" cy="-4" rx="11" ry="8" fill="${skL}" opacity=".4"/><ellipse cx="0" cy="7" rx="12" ry="3" fill="${skDD}" opacity=".22"/>`,
    };
    const NP = { button: [10, 8, 0.5], straight: [9, 6.5, 1], small: [7.5, 6, 0.4], wide: [14, 9, 0.6], roman: [10, 7.5, 1.3], broad: [15, 10, 0.5] }[c.nose] || [10, 8, 0.5];
    const [nW, nT, nB] = NP, nos = sh(sk, -0.62);
    const noseArt = `<g transform="translate(${CX} ${G.noseY.toFixed(1)}) scale(${G.ns.toFixed(3)})">
<ellipse cx="9" cy="-20" rx="6.5" ry="21" fill="${skDD}" opacity="${(0.24 + 0.12 * nB).toFixed(2)}" filter="url(#${u}b4)"/>
<ellipse cx="-3" cy="-25" rx="4" ry="16" fill="#fff" opacity="${(0.12 + 0.1 * nB).toFixed(2)}" filter="url(#${u}b2)"/>
<ellipse cx="0" cy="7" rx="${nW + 4}" ry="5" fill="${skDD}" opacity=".5" filter="url(#${u}b2)"/>
<ellipse cx="${-nW + 1}" cy="0" rx="6.5" ry="6" fill="${skD}" filter="url(#${u}b1)"/><ellipse cx="${nW - 1}" cy="0" rx="6.5" ry="6" fill="${sh(skD, -0.06)}" filter="url(#${u}b1)"/>
<circle cx="0" cy="-3" r="${nT}" fill="${sk}" filter="url(#${u}b05)"/><circle cx="-1.6" cy="-5" r="${(nT * 0.75).toFixed(1)}" fill="${skL}" opacity=".85" filter="url(#${u}b2)"/><circle cx="-2.6" cy="-7.2" r="${(nT * 0.28).toFixed(1)}" fill="#fff" opacity=".4" filter="url(#${u}b05)"/>
<ellipse cx="${-nW + 5.5}" cy="3.4" rx="3.4" ry="2" fill="${nos}" opacity=".8" filter="url(#${u}b05)" transform="rotate(-14 ${-nW + 5.5} 3.4)"/><ellipse cx="${nW - 5.5}" cy="3.4" rx="3.4" ry="2" fill="${nos}" opacity=".8" filter="url(#${u}b05)" transform="rotate(14 ${nW - 5.5} 3.4)"/>
<path d="M${-nW - 3} -11 C${-nW - 7} -3 ${-nW - 6} 4 ${-nW + 1} 7 M${nW + 3} -11 C${nW + 7} -3 ${nW + 6} 4 ${nW - 1} 7" stroke="${skDD}" stroke-width="2" fill="none" opacity=".35" filter="url(#${u}b05)"/><path d="M-6 -46 C-8 -34 -9 -24 -10 -16" stroke="${skDD}" stroke-width="5" fill="none" opacity=".16" filter="url(#${u}b2)"/>
${c.nose === "roman" ? `<ellipse cx="2" cy="-30" rx="3" ry="6" fill="#fff" opacity=".2" filter="url(#${u}b1)"/>` : ""}</g>`;

    // mouth (center line at y=0)
    const MO = {
      smile: `<path d="M-24 0 C-15 -6 -6 -6.5 0 -3.6 C6 -6.5 15 -6 24 0 C14 1.5 -14 1.5 -24 -1Z" fill="${sh(lip, -0.18)}" opacity=".85"/><path d="M-19 4 C-10 15 10 15 19 4 C10 8 -10 8 -19 4Z" fill="url(#${u}lp)"/><path d="M-27 -2 C-14 8 14 8 27 -2" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M-29 -5 C-28 -2 -27 -1 -25 0 M29 -5 C28 -2 27 -1 25 0" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".6"/>`,
      softsmile: `<path d="M-23 -1 C-14 -7 -6 -6 0 -3 C6 -6 14 -7 23 -1 C12 3 -12 3 -23 -1Z" fill="${sh(lip, -0.12)}"/><path d="M-21 0 C-11 12 11 12 21 0 C10 3 -10 3 -21 0Z" fill="url(#${u}lp)"/><path d="M-24 -1 C-12 4 12 4 24 -1" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="-2" cy="6" rx="7" ry="2" fill="#fff" opacity=".25"/>`,
      grin: `<path d="M-29 -4 C-14 2 14 2 29 -4 C23 21 -23 21 -29 -4Z" fill="#3A1218"/><path d="M-26 -2 C-13 3 13 3 26 -2 L24 6 C12 9 -12 9 -24 6Z" fill="#fff"/><path d="M-12 18 C-6 13 6 13 12 18" fill="#E05A70"/><path d="M-29 -4 C-14 2 14 2 29 -4 C23 21 -23 21 -29 -4Z" fill="none" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2.6" stroke-linejoin="round"/><path d="M-14 20 C-6 23 6 23 14 20" stroke="${lip}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`,
      laugh: `<path d="M-30 -6 C-14 0 14 0 30 -6 C26 30 -26 30 -30 -6Z" fill="#3A1218"/><path d="M-27 -4 C-13 1 13 1 27 -4 L25 4 C12 7 -12 7 -25 4Z" fill="#fff"/><ellipse cx="0" cy="18" rx="13" ry="7" fill="#E05A70"/><path d="M-30 -6 C-14 0 14 0 30 -6 C26 30 -26 30 -30 -6Z" fill="none" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2.6" stroke-linejoin="round"/>`,
      smirk: `<path d="M-14 6 C-6 11 6 10 14 4 C6 7 -6 8 -14 6Z" fill="url(#${u}lp)"/><path d="M-21 2 C-8 7 10 5 26 -7" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M27 -10 C27 -7 26 -5 24 -4" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`,
      neutral: `<path d="M-20 0 C-12 -5 -5 -4 0 -2 C5 -4 12 -5 20 0 C10 2 -10 2 -20 0Z" fill="${sh(lip, -0.12)}"/><path d="M-17 1 C-9 10 9 10 17 1 C8 3 -8 3 -17 1Z" fill="url(#${u}lp)"/><path d="M-21 0 C-8 2 8 2 21 0" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
      open: `<ellipse cx="0" cy="4" rx="12" ry="15" fill="#3A1218"/><ellipse cx="0" cy="12" rx="8" ry="5" fill="#E05A70"/><ellipse cx="0" cy="4" rx="12" ry="15" fill="none" stroke="${lip}" stroke-width="4"/>`,
      serious: `<path d="M-22 2 C-8 -1 8 -1 22 2" stroke="${lipD}" filter="url(#${u}b05)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M-14 6 C-6 10 6 10 14 6" stroke="${lip}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`,
    };
    const lipShine = ["smile", "softsmile", "neutral", "smirk", "serious"].includes(c.mouth) ? `<ellipse cx="-3" cy="9" rx="7" ry="2.2" fill="#fff" opacity="${c.lipA > 0.3 ? 0.42 : 0.26}" filter="url(#${u}b1)"/>` : "";
    const grillOn = c.grill && c.grill !== "none", mKey = grillOn && !["grin", "laugh"].includes(c.mouth) ? "grin" : c.mouth;
    const teethD = mKey === "laugh" ? "M-27 -4 C-13 1 13 1 27 -4 L25 4 C12 7 -12 7 -25 4Z" : "M-26 -2 C-13 3 13 3 26 -2 L24 6 C12 9 -12 9 -24 6Z";
    const gm = c.grill === "silver" ? METAL.silver : c.grill === "iced" ? ["#FFFFFF", "#AEB6C6"] : METAL.gold;
    const grillArt = grillOn ? `<defs><linearGradient id="${u}grl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${gm[0]}"/><stop offset="1" stop-color="${gm[1]}"/></linearGradient></defs><path d="${teethD}" fill="url(#${u}grl)"/><g stroke="${sh(gm[1], -0.35)}" stroke-width="1" opacity=".8">${[-18, -11, -4, 3, 10, 17].map((x) => `<path d="M${x + 0.5} -2 v9"/>`).join("")}</g>${c.grill === "iced" ? `<g fill="#fff">${[-22, -15, -8, -1, 6, 13, 20].map((x, i) => `<circle cx="${x}" cy="${1 + (i % 2) * 2}" r="1.4"/>`).join("")}</g><path d="M14 -9 l1.5 -4 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5z" fill="#fff"/>` : `<path d="M-20 0 C-8 3 8 3 20 0" stroke="#fff" stroke-width="1.6" opacity=".7" fill="none"/>`}` : "";
    const mouthArt = `<g transform="translate(${CX} ${G.mouthY.toFixed(1)}) scale(${G.mw.toFixed(3)} ${G.lips.toFixed(3)})"><ellipse cx="-30" cy="-2" rx="5" ry="5" fill="${skDD}" opacity=".22" filter="url(#${u}b2)"/><ellipse cx="30" cy="-2" rx="5" ry="5" fill="${skDD}" opacity=".22" filter="url(#${u}b2)"/>${MO[mKey] || MO.smile}${grillArt}${grillOn ? "" : lipShine}</g>`;

    // facial hair: soft-edged areas with real short-hair texture, strands that follow the jaw, and shading
    const bcD = sh(bc, -0.3), bcDD = sh(bc, -0.55), bcL = mix(sh(bc, 0.3), "#FFFFFF", lum(bc) > 0.6 ? 0.05 : 0.2);
    const my = G.mouthY;
    let bdefs = speck("bsd", bcDD, 1.1, 21, 3.3, -1.45) + speck("bsl", bcL, 1.1, 27, 3, -1.62) + speck("bst", mix(bcDD, sk, 0.2), 1.7, 33, 3.7, -1.6, 1) + speck("bst2", bcDD, 0.9, 41, 3, -1.5, 1) + speck("bcb", bcDD, 0.06, 4, 2, -0.9, 3)
      + `<linearGradient id="${u}bg2" gradientUnits="userSpaceOnUse" x1="0" y1="${my - 40}" x2="0" y2="${chinY + 50}"><stop offset="0" stop-color="${sh(bc, 0.1)}"/><stop offset=".55" stop-color="${bc}"/><stop offset="1" stop-color="${bcD}"/></linearGradient>`
      + `<linearGradient id="${u}mg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(bc, 0.12)}"/><stop offset="1" stop-color="${bcD}"/></linearGradient>`;
    const cheekCut = (y0) => `M0 -50 H400 V${y0} C${CX + hw} ${y0 + 2} ${CX + 70} ${my - 30} ${CX + 34} ${my - 22} C${CX + 16} ${my - 18} ${CX - 16} ${my - 18} ${CX - 34} ${my - 22} C${CX - 70} ${my - 30} ${CX - hw} ${y0 + 2} 0 ${y0}Z`;
    const bStrands = (y0, y1, n, L0, L1) => {
      if (!big) return "";
      const bins = [[], [], []];
      for (let i = 0; i < n; i++) {
        const x = CX - hw - 12 + R() * (hw * 2 + 24), y = y0 + R() * (y1 - y0);
        const dir = nrm([(x - CX) * 0.011 + (R() - 0.5) * 0.4, 1]), L = L0 + R() * (L1 - L0);
        const b = R() < 0.22 * (x < CX ? 1.3 : 0.7) ? 2 : R() < 0.55 ? 0 : 1;
        bins[b].push(`M${PP(x, y)}q${PP(dir[0] * L * 0.5 + (R() - 0.5) * 2, dir[1] * L * 0.5)} ${PP(dir[0] * L, dir[1] * L)}`);
      }
      const st = [[bcDD, 1.15, 0.5], [sh(bc, 0.05), 1.2, 0.45], [bcL, 1, 0.4]];
      return bins.map((b, i) => (b.length ? `<path d="${b.join("")}" fill="none" stroke="${st[i][0]}" stroke-width="${st[i][1]}" opacity="${st[i][2]}" stroke-linecap="round" filter="url(#${u}g05)"/>` : "")).join("");
    };
    const fuzz = (maskInner, o) => {
      const id = `${u}bk${++hid}`;
      bdefs += `<mask id="${id}" maskUnits="userSpaceOnUse" x="-150" y="-200" width="700" height="900">${maskInner}</mask>`;
      let a = "";
      if (o.base) a += `<rect x="0" y="120" width="400" height="400" fill="url(#${u}bg2)" opacity="${o.base}"/>`;
      if (o.tint) a += `<rect x="0" y="120" width="400" height="400" fill="${mix(bcDD, sk, 0.35)}" opacity="${o.tint}"/>`;
      a += texR("bcb", o.blot ?? 0.3);
      if (o.stub) a += texR("bst", o.stub) + texR("bst2", o.stub * 0.5);
      else a += texR("bsd", o.dark ?? 0.8) + texR("bsl", o.light ?? 0.42);
      if (o.n) a += bStrands(o.y0, o.y1, o.n, o.L[0], o.L[1]);
      if (o.base) a += `<ellipse cx="${CX}" cy="${chinY + (o.low ?? 14)}" rx="${jw + 18}" ry="36" fill="#000" opacity=".3" filter="url(#${u}g8)"/><ellipse cx="${CX - 34}" cy="${my - 4}" rx="46" ry="22" fill="${bcL}" opacity=".16" filter="url(#${u}g8)"/><ellipse cx="${CX + hw - 8}" cy="${my}" rx="18" ry="60" fill="#000" opacity=".2" filter="url(#${u}g8)"/>`;
      return `<g mask="url(#${id})">${a}</g>`;
    };
    const cheek = (y0, soft = 4) => `<path d="${cheekCut(y0)}" fill="#000" filter="url(#${u}g${soft})"/>`;
    const tufts = () => "";
    // loose hairs that break the outline (ellipse cx, cy, rx, ry, angle range)
    const edgeHairs = (cx, cy, rx, ry, a0, a1, n, L0, L1) => {
      if (!size || size < 90) return "";
      const bins = [[], []];
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * R(), x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, nx = Math.cos(a) * 0.55, ny = Math.sin(a) + 0.35, l = Math.hypot(nx, ny), L = L0 + R() * (L1 - L0);
        const sx0 = x - (nx / l) * 3, sy0 = y - (ny / l) * 3;
        bins[R() < 0.65 ? 0 : 1].push(`M${PP(sx0, sy0)}q${PP((nx / l) * L * 0.5 + (R() - 0.5) * 3, (ny / l) * L * 0.5)} ${PP((nx / l) * L + (R() - 0.5) * 2, (ny / l) * L)}`);
      }
      return `<path d="${bins[0].join("")}" fill="none" stroke="${bcD}" stroke-width="1.5" opacity=".8" stroke-linecap="round" filter="url(#${u}g05)"/><path d="${bins[1].join("")}" fill="none" stroke="${sh(bc, 0.08)}" stroke-width="1.3" opacity=".7" stroke-linecap="round" filter="url(#${u}g05)"/>`;
    };
    // mustaches (local coords: center of the upper lip)
    const STACHE = {
      std: "M-29 6 C-26 -2 -16 -8 -6 -7 C-3 -7 -1 -5 0 -4 C1 -5 3 -7 6 -7 C16 -8 26 -2 29 6 C22 3 14 2 6 3 C3 3 1 4 0 5 C-1 4 -3 3 -6 3 C-14 2 -22 3 -29 6Z",
      full: "M-33 11 C-30 -2 -18 -9 -6 -8 C-3 -8 -1 -6 0 -5 C1 -6 3 -8 6 -8 C18 -9 30 -2 33 11 C24 5 14 4 6 5 C3 5 1 6 0 7 C-1 6 -3 5 -6 5 C-14 4 -24 5 -33 11Z",
      handlebar: "M-37 -9 C-41 0 -37 7 -30 5 C-26 -2 -16 -8 -6 -7 C-3 -7 -1 -5 0 -4 C1 -5 3 -7 6 -7 C16 -8 26 -2 30 5 C37 7 41 0 37 -9 C39 0 35 3 30 0 C24 -2 14 1 6 3 C3 3 1 4 0 5 C-1 4 -3 3 -6 3 C-14 1 -24 -2 -30 0 C-35 3 -39 0 -37 -9Z",
      pencil: "M-25 3 C-16 -1.5 -6 -1.5 0 -0.5 C6 -1.5 16 -1.5 25 3 C16 1.4 6 1.4 0 2.4 C-6 1.4 -16 1.4 -25 3Z",
    };
    const stache = (key, a = 1) => {
      const d = STACHE[key], id = `${u}bk${++hid}`;
      bdefs += `<clipPath id="${id}"><path d="${d}"/></clipPath>`;
      let s = "";
      if (big) { const bins = [[], []]; for (let i = 0; i < 110; i++) { const x = -36 + R() * 72, y = -10 + R() * 16, dir = nrm([x * 0.03 + (R() - 0.5) * 0.5, 1]), L = 2.5 + R() * 4; bins[R() < 0.55 ? 0 : 1].push(`M${PP(x, y)}l${PP(dir[0] * L, dir[1] * L)}`); } s = `<path d="${bins[0].join("")}" stroke="${bcDD}" stroke-width="1" opacity=".4" stroke-linecap="round" fill="none" filter="url(#${u}g05)"/><path d="${bins[1].join("")}" stroke="${bcL}" stroke-width=".9" opacity=".3" stroke-linecap="round" fill="none" filter="url(#${u}g05)"/>` + texR("bsd", 0.5); }
      return `<g transform="translate(${CX} ${(my - 13).toFixed(1)}) scale(${G.mw.toFixed(3)} 1)" opacity="${a}"><path d="${d}" fill="#000" opacity=".28" filter="url(#${u}g1)" transform="translate(0 2)"/><path d="${d}" fill="url(#${u}mg2)" filter="url(#${u}g05)"/><g clip-path="url(#${id})">${s}<path d="M-24 -1 C-14 -7 -4 -6 0 -3 C4 -6 14 -7 24 -1" fill="none" stroke="${bcL}" stroke-width="2.6" opacity=".28" filter="url(#${u}g1)"/></g>${key === "pencil" || !big ? "" : `<path d="${Array.from({ length: 26 }, (_, i) => { const x = -27 + (54 * i) / 25 + (R() - 0.5) * 2, y = 3 + Math.abs(x) * 0.08; return `M${PP(x, y)}l${PP(x * 0.04 + (R() - 0.5), 2.5 + R() * 2.5)}`; }).join("")}" stroke="${bcD}" stroke-width="1.1" opacity=".75" stroke-linecap="round" fill="none" filter="url(#${u}g05)"/>`}</g>`;
    };
    const goateeD = `M${CX - 25} ${my + 9} C${CX - 28} ${chinY - 6} ${CX - 16} ${chinY + 13} ${CX} ${chinY + 13} C${CX + 16} ${chinY + 13} ${CX + 28} ${chinY - 6} ${CX + 25} ${my + 9} C${CX + 12} ${my + 16} ${CX - 12} ${my + 16} ${CX - 25} ${my + 9}Z`;
    const circleSides = `M${CX - 30} ${my - 8} C${CX - 34} ${my + 4} ${CX - 30} ${my + 12} ${CX - 24} ${my + 14} L${CX - 17} ${my + 11} C${CX - 22} ${my + 4} ${CX - 24} ${my - 2} ${CX - 22} ${my - 8}Z M${CX + 30} ${my - 8} C${CX + 34} ${my + 4} ${CX + 30} ${my + 12} ${CX + 24} ${my + 14} L${CX + 17} ${my + 11} C${CX + 22} ${my + 4} ${CX + 24} ${my - 2} ${CX + 22} ${my - 8}Z`;
    let beardArt = "", beardTop = "";
    const bk = c.beard;
    if (bk === "stubble") {
      beardArt = fuzz(`<path d="${facePath(hw + 1, jw + 1, chinY + 3, cw + 1)}" fill="#fff" filter="url(#${u}g2)"/>${cheek(222, 8)}`, { tint: 0.16, stub: 0.95, blot: 0.15 });
    } else if (["short", "full", "long"].includes(bk)) {
      const ext = { short: 6, full: 14, long: 16 }[bk], y0 = bk === "short" ? 232 : 216;
      const longPart = bk === "long" ? `<path d="M${CX - jw - 4} ${chinY - 40} C${CX - jw + 4} ${chinY + 40} ${CX - 30} ${chinY + 72} ${CX} ${chinY + 80} C${CX + 30} ${chinY + 72} ${CX + jw - 4} ${chinY + 40} ${CX + jw + 4} ${chinY - 40}Z" fill="#fff" filter="url(#${u}g2)"/>` : "";
      beardArt = fuzz(`<path d="${facePath(hw + 3, jw + ext, chinY + ext * 1.3, cw + ext)}" fill="#fff" filter="url(#${u}g05)"/>${longPart}${cheek(y0, bk === "short" ? 4 : 2)}`, { base: 1, n: bk === "short" ? 380 : 620, y0: y0 - 20, y1: chinY + ext * 1.3 + (bk === "long" ? 80 : 6), L: bk === "short" ? [3, 6] : bk === "full" ? [5, 9] : [7, 13], low: bk === "long" ? 50 : 16 });
      beardArt += bk === "long" ? edgeHairs(CX, chinY + 4, jw * 0.75, 74, 0.2, Math.PI - 0.2, 120, 5, 11) : edgeHairs(CX, chinY - 46, jw + ext - 3, 46 + ext * 1.3 - 2, 0.12, Math.PI - 0.12, bk === "short" ? 70 : 130, bk === "short" ? 3 : 4, bk === "short" ? 6 : 10);
      if (bk === "long") beardArt += `<path d="M${CX - 18} ${chinY + 14} C${CX - 14} ${chinY + 40} ${CX - 8} ${chinY + 58} ${CX} ${chinY + 70} M${CX + 16} ${chinY + 10} C${CX + 14} ${chinY + 36} ${CX + 10} ${chinY + 52} ${CX + 4} ${chinY + 64}" stroke="${bcDD}" stroke-width="3" fill="none" opacity=".35" filter="url(#${u}g1)"/>`;
      beardTop = stache(bk === "short" ? "std" : "full");
    } else if (bk === "chinstrap") {
      beardArt = fuzz(`<path d="${facePath(hw + 3, jw + 6, chinY + 7, cw + 6)}" fill="#fff" filter="url(#${u}g1)"/><path d="${facePath(hw - 9, jw - 13, chinY - 13, cw - 10)}" fill="#000" filter="url(#${u}g2)"/><rect x="0" y="-50" width="400" height="${226 + 50}" fill="#000" filter="url(#${u}g4)"/>`, { base: 1, n: 220, y0: 220, y1: chinY + 8, L: [3, 6], low: 10 });
    } else if (bk === "goatee" || bk === "circle" || bk === "soulpatch") {
      const m = bk === "soulpatch" ? `<path d="M${CX - 8} ${my + 15} Q${CX} ${my + 32} ${CX + 8} ${my + 15} Q${CX} ${my + 19} ${CX - 8} ${my + 15}Z" fill="#fff" filter="url(#${u}g05)"/>` : `<path d="${goateeD}" fill="#fff" filter="url(#${u}g1)"/>${bk === "circle" ? `<path d="${circleSides}" fill="#fff" filter="url(#${u}g1)"/>` : ""}`;
      beardArt = fuzz(m.replace(/g1\)/g, "g05)"), { base: 1, n: 160, y0: my - 10, y1: chinY + 14, L: [3, 6], low: 6 }) + (bk === "soulpatch" ? "" : edgeHairs(CX, my + 14, 25, chinY - my - 1, 0.25, Math.PI - 0.25, 36, 3, 6));
      if (bk !== "soulpatch") beardTop = stache("std");
    } else if (bk === "mustache") beardTop = stache("std");
    else if (bk === "handlebar") beardTop = stache("handlebar");
    else if (bk === "pencil") beardTop = stache("pencil");
    const beardTex = "";
    defs = defs.replace("</defs>", bdefs + "</defs>");
    // piercings
    const pm = `url(#${u}mt)`;
    const pierceArt = {
      nosestud: `<circle cx="${CX + 10 * G.ns}" cy="${G.noseY - 3}" r="2.6" fill="${pm}"/>`, nosering: `<circle cx="${CX + 9 * G.ns}" cy="${G.noseY + 4}" r="5" fill="none" stroke="${pm}" stroke-width="2"/>`,
      septum: `<path d="M${CX - 5} ${G.noseY + 5} C${CX - 5} ${G.noseY + 13} ${CX + 5} ${G.noseY + 13} ${CX + 5} ${G.noseY + 5}" stroke="${pm}" stroke-width="2.4" fill="none"/>`,
      brow: `<circle cx="${CX + gap + 20}" cy="${G.browY - 3}" r="2.4" fill="${pm}"/><circle cx="${CX + gap + 22}" cy="${G.browY + 7}" r="2.4" fill="${pm}"/>`,
      lip: `<circle cx="${CX - 12}" cy="${my + 10}" r="5" fill="none" stroke="${pm}" stroke-width="2.2"/>`,
    }[c.piercing] || "";

    /* ---- glasses ---- */
    const gc = okHex(c.glassColor) ? c.glassColor : "#121318";
    const xL = CX - gap, xR = CX + gap, gy = eyeY;
    const lensDef = (id, col, a) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="${a}"/><stop offset="1" stop-color="${sh(col, -0.4)}" stop-opacity="${Math.min(1, a + 0.15)}"/></linearGradient>`;
    const lensC = okHex(c.lensColor) ? c.lensColor : null, lensA = lensC ? +(0.32 + (1 - lum(lensC)) * 0.55).toFixed(2) : 0;
    defs = defs.replace("</defs>", (lensC ? lensDef("lc", lensC, lensA) + lensDef("ld", lensC, lensA) + lensDef("lt", lensC, lensA) : lensDef("lc", "#BFE3FF", 0.12) + lensDef("ld", "#1A1A24", 0.86) + lensDef("lt", "#FF4FA3", 0.6)) + "</defs>");
    const temple = `<path d="M${xL - 24} ${gy - 6} L${CX - hw + 2} ${gy - 2} M${xR + 24} ${gy - 6} L${CX + hw - 2} ${gy - 2}" stroke="${gc}" stroke-width="3"/>`;
    const glint = (x) => `<path d="M${x - 12} ${gy - 6} l8 -6" stroke="#fff" stroke-width="2.6" opacity=".55" stroke-linecap="round"/>`;
    const GL = {
      none: "",
      rect: `${temple}<g fill="url(#${u}lc)" stroke="${gc}" stroke-width="3.6"><rect x="${xL - 24}" y="${gy - 15}" width="48" height="32" rx="8"/><rect x="${xR - 24}" y="${gy - 15}" width="48" height="32" rx="8"/></g><path d="M${xL + 24} ${gy - 4} C${CX - 6} ${gy - 10} ${CX + 6} ${gy - 10} ${xR - 24} ${gy - 4}" stroke="${gc}" stroke-width="3.6" fill="none"/>${glint(xL)}${glint(xR)}`,
      round: `${temple}<g fill="url(#${u}lc)" stroke="${gc}" stroke-width="3.2"><circle cx="${xL}" cy="${gy + 1}" r="21"/><circle cx="${xR}" cy="${gy + 1}" r="21"/></g><path d="M${xL + 21} ${gy - 2} C${CX - 6} ${gy - 10} ${CX + 6} ${gy - 10} ${xR - 21} ${gy - 2}" stroke="${gc}" stroke-width="3.2" fill="none"/>${glint(xL)}${glint(xR)}`,
      aviator: `${temple}<g fill="url(#${u}lt)" stroke="${gc}" stroke-width="2.4"><path d="M${xL - 25} ${gy - 14} H${xL + 21} C${xL + 26} ${gy - 14} ${xL + 26} ${gy - 8} ${xL + 24} ${gy} C${xL + 20} ${gy + 18} ${xL + 6} ${gy + 22} ${xL - 6} ${gy + 20} C${xL - 20} ${gy + 18} ${xL - 27} ${gy + 4} ${xL - 25} ${gy - 14}Z"/><path d="${mir(`M${xL - 25} ${gy - 14} H${xL + 21} C${xL + 26} ${gy - 14} ${xL + 26} ${gy - 8} ${xL + 24} ${gy} C${xL + 20} ${gy + 18} ${xL + 6} ${gy + 22} ${xL - 6} ${gy + 20} C${xL - 20} ${gy + 18} ${xL - 27} ${gy + 4} ${xL - 25} ${gy - 14}Z`).replace(/H(\d+)/, (m, v) => "H" + (400 - +v))}"/></g><path d="M${xL + 22} ${gy - 12} H${xR - 22} M${xL + 24} ${gy - 4} C${CX - 6} ${gy - 8} ${CX + 6} ${gy - 8} ${xR - 24} ${gy - 4}" stroke="${gc}" stroke-width="2.4" fill="none"/>${glint(xL)}${glint(xR)}`,
      cateye: `${temple}<g fill="url(#${u}lc)" stroke="${gc}" stroke-width="4.2" stroke-linejoin="round"><path d="M${xL - 30} ${gy - 18} C${xL - 10} ${gy - 16} ${xL + 14} ${gy - 16} ${xL + 24} ${gy - 8} C${xL + 26} ${gy + 10} ${xL + 12} ${gy + 18} ${xL - 2} ${gy + 17} C${xL - 18} ${gy + 16} ${xL - 26} ${gy + 4} ${xL - 30} ${gy - 18}Z"/><path d="${mir(`M${xL - 30} ${gy - 18} C${xL - 10} ${gy - 16} ${xL + 14} ${gy - 16} ${xL + 24} ${gy - 8} C${xL + 26} ${gy + 10} ${xL + 12} ${gy + 18} ${xL - 2} ${gy + 17} C${xL - 18} ${gy + 16} ${xL - 26} ${gy + 4} ${xL - 30} ${gy - 18}Z`)}"/></g><path d="M${xL + 24} ${gy - 6} C${CX - 6} ${gy - 12} ${CX + 6} ${gy - 12} ${xR - 24} ${gy - 6}" stroke="${gc}" stroke-width="3.6" fill="none"/>${glint(xL)}${glint(xR)}`,
      browline: `${temple}<g fill="url(#${u}lc)" stroke="${sh(gc, 0.35)}" stroke-width="1.8"><path d="M${xL - 24} ${gy - 12} H${xL + 24} C${xL + 24} ${gy + 8} ${xL + 14} ${gy + 17} ${xL} ${gy + 17} C${xL - 14} ${gy + 17} ${xL - 24} ${gy + 8} ${xL - 24} ${gy - 12}Z"/><path d="M${xR - 24} ${gy - 12} H${xR + 24} C${xR + 24} ${gy + 8} ${xR + 14} ${gy + 17} ${xR} ${gy + 17} C${xR - 14} ${gy + 17} ${xR - 24} ${gy + 8} ${xR - 24} ${gy - 12}Z"/></g><g stroke="${gc}" stroke-width="8" stroke-linecap="round"><path d="M${xL - 22} ${gy - 12} H${xL + 22} M${xR - 22} ${gy - 12} H${xR + 22}"/></g><path d="M${xL + 24} ${gy - 8} H${xR - 24}" stroke="${sh(gc, 0.35)}" stroke-width="2.4"/>`,
      sunglasses: `${temple}<g fill="url(#${u}ld)" stroke="${gc}" stroke-width="3.4" stroke-linejoin="round"><path d="M${xL - 27} ${gy - 15} H${xL + 25} L${xL + 22} ${gy + 6} C${xL + 18} ${gy + 17} ${xL - 18} ${gy + 17} ${xL - 23} ${gy + 6}Z"/><path d="M${xR + 27} ${gy - 15} H${xR - 25} L${xR - 22} ${gy + 6} C${xR - 18} ${gy + 17} ${xR + 18} ${gy + 17} ${xR + 23} ${gy + 6}Z"/></g><path d="M${xL + 25} ${gy - 9} H${xR - 25}" stroke="${gc}" stroke-width="4"/><path d="M${xL - 16} ${gy - 8} l12 -3 M${xR - 16} ${gy - 8} l12 -3" stroke="#fff" stroke-width="3" opacity=".45" stroke-linecap="round"/>`,
      sport: `<path d="M${CX - hw - 2} ${gy - 8} C${CX - 60} ${gy - 22} ${CX + 60} ${gy - 22} ${CX + hw + 2} ${gy - 8} L${CX + hw - 4} ${gy + 6} C${CX + 60} ${gy + 22} ${CX + 14} ${gy + 14} ${CX} ${gy + 4} C${CX - 14} ${gy + 14} ${CX - 60} ${gy + 22} ${CX - hw + 4} ${gy + 6}Z" fill="url(#${u}lt)" stroke="${gc}" stroke-width="3"/><path d="M${CX - 70} ${gy - 8} C${CX - 30} ${gy - 16} ${CX + 30} ${gy - 16} ${CX + 70} ${gy - 8}" stroke="#fff" stroke-width="2.4" opacity=".5" fill="none"/>`,
      oversized: `${temple}<g fill="url(#${u}lt)" stroke="${gc}" stroke-width="3.6"><circle cx="${xL - 2}" cy="${gy + 3}" r="27"/><circle cx="${xR + 2}" cy="${gy + 3}" r="27"/></g><path d="M${xL + 24} ${gy - 6} C${CX - 6} ${gy - 12} ${CX + 6} ${gy - 12} ${xR - 24} ${gy - 6}" stroke="${gc}" stroke-width="3.6" fill="none"/>${glint(xL)}${glint(xR)}`,
      shutter: `${temple}<g fill="none" stroke="${gc}" stroke-width="4" stroke-linejoin="round"><path d="M${xL - 28} ${gy - 16} H${xL + 25} L${xL + 22} ${gy + 8} C${xL + 18} ${gy + 17} ${xL - 20} ${gy + 17} ${xL - 25} ${gy + 8}Z"/><path d="M${xR + 28} ${gy - 16} H${xR - 25} L${xR - 22} ${gy + 8} C${xR - 18} ${gy + 17} ${xR + 20} ${gy + 17} ${xR + 25} ${gy + 8}Z"/></g><g stroke="${gc}" stroke-width="3.4">${[-9, -2, 5, 12].map((dy) => `<path d="M${xL - 26} ${gy + dy} H${xL + 23} M${xR - 23} ${gy + dy} H${xR + 26}"/>`).join("")}</g><path d="M${xL + 25} ${gy - 10} H${xR - 25}" stroke="${gc}" stroke-width="4"/>`,
      rimless: `<path d="M${xL - 24} ${gy - 6} L${CX - hw + 2} ${gy - 2} M${xR + 24} ${gy - 6} L${CX + hw - 2} ${gy - 2}" stroke="${gc}" stroke-width="2"/><g fill="url(#${u}lc)" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"><rect x="${xL - 23}" y="${gy - 13}" width="46" height="28" rx="11"/><rect x="${xR - 23}" y="${gy - 13}" width="46" height="28" rx="11"/></g><path d="M${xL + 23} ${gy - 4} C${CX - 6} ${gy - 9} ${CX + 6} ${gy - 9} ${xR - 23} ${gy - 4}" stroke="${gc}" stroke-width="2" fill="none"/>${glint(xL)}${glint(xR)}`,
    };
    const glassesArt = GL[c.glasses] || "";

    /* ---- headwear ---- */
    const hf = `url(#${u}ht)`, hD = sh(htc, -0.28), hL = sh(htc, 0.3);
    const crown = (bot, top) => `M${CX - hw - 10} ${bot} C${CX - hw - 12} ${top + 40} ${CX - 52} ${top} ${CX} ${top} C${CX + 52} ${top} ${CX + hw + 12} ${top + 40} ${CX + hw + 10} ${bot}Z`;
    const capInk = lum(htc) > 0.6 ? "#16295A" : "#FFFFFF";
    let hdefs2 = "";
    // volume + cloth texture inside a hat piece
    const hs = (d, o = {}) => { const id = `${u}hz${++hid}`; hdefs2 += `<clipPath id="${id}"><path d="${d}"/></clipPath>`; return `<g clip-path="url(#${id})"><rect x="0" y="-40" width="400" height="300" fill="url(#${u}htv)"/><rect x="0" y="-40" width="400" height="300" filter="url(#${u}${o.knit ? "knit" : "fab"})" opacity="${o.knit ? 0.38 : 0.16}" style="mix-blend-mode:soft-light"/><path d="${d}" fill="none" stroke="#000" stroke-width="${o.edge ?? 10}" opacity=".28" filter="url(#${u}b4)"/>${o.extra || ""}</g>`; };
    hdefs2 += `<radialGradient id="${u}htv" gradientUnits="userSpaceOnUse" cx="${CX - 30}" cy="48" r="150"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></radialGradient>`;
    const st2 = (d, col = hL, o = 0.55) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.2" stroke-dasharray="3 2.2" opacity="${o}"/>`;
    const capCrown = crown(122, 24);
    const capBrim = `M${CX - hw - 10} 116 C${CX - 70} 100 ${CX + 70} 100 ${CX + hw + 10} 116 C${CX + hw + 4} 140 ${CX + 50} 156 ${CX} 157 C${CX - 50} 156 ${CX - hw - 4} 140 ${CX - hw - 10} 116Z`;
    const beanieD = `M${CX - hw - 9} 126 C${CX - hw - 14} 60 ${CX - 60} 14 ${CX} 14 C${CX + 60} 14 ${CX + hw + 14} 60 ${CX + hw + 9} 126Z`;
    const bucketCrown = `M${CX - hw - 8} 118 C${CX - hw - 10} 84 ${CX - hw + 4} 50 ${CX - 50} 44 C${CX - 20} 40 ${CX + 20} 40 ${CX + 50} 44 C${CX + hw - 4} 50 ${CX + hw + 10} 84 ${CX + hw + 8} 118Z`, bucketBrim = `M${CX - hw - 12} 108 C${CX - 50} 98 ${CX + 50} 98 ${CX + hw + 12} 108 C${CX + hw + 26} 122 ${CX + hw + 38} 136 ${CX + hw + 40} 146 C${CX + 60} 136 ${CX - 60} 136 ${CX - hw - 40} 146 C${CX - hw - 38} 136 ${CX - hw - 26} 122 ${CX - hw - 12} 108Z`;
    const fedCrown = `M${CX - hw + 8} 110 C${CX - hw + 4} 60 ${CX - 50} 22 ${CX} 36 C${CX + 50} 22 ${CX + hw - 4} 60 ${CX + hw - 8} 110Z`;
    const hpBand = `M${CX - hw - 8} 214 C${CX - hw - 22} 70 ${CX - 50} 28 ${CX} 28 C${CX + 50} 28 ${CX + hw + 22} 70 ${CX + hw + 8} 214`;
    const cup = (s, w = 30, h = 54) => { const x = CX + s * (hw + 8); return `<rect x="${x - w / 2}" y="${212 - h / 2}" width="${w}" height="${h}" rx="${w / 2 - 2}" fill="${sh(htc, -0.35)}"/><rect x="${x - w / 2 + 3 * s}" y="${212 - h / 2 + 3}" width="${w - 3}" height="${h - 6}" rx="${w / 2 - 3}" fill="${hf}"/><ellipse cx="${x + s * 2}" cy="${212 - h / 4}" rx="${w / 5}" ry="${h / 6}" fill="#fff" opacity=".22" filter="url(#${u}b2)"/>`; };
    const HATS = {
      none: "",
      cap: `<path d="${capCrown}" fill="${hf}"/>${hs(capCrown, { extra: `<path d="M${CX - 30} 28 C${CX - 40} 60 ${CX - 44} 96 ${CX - 44} 122 M${CX + 30} 28 C${CX + 40} 60 ${CX + 44} 96 ${CX + 44} 122 M${CX - 64} 44 C${CX - 84} 70 ${CX - 94} 96 ${CX - 96} 122 M${CX + 64} 44 C${CX + 84} 70 ${CX + 94} 96 ${CX + 96} 122" stroke="${hD}" stroke-width="2.4" fill="none" opacity=".6"/>${st2(`M${CX - 34} 30 C${CX - 44} 62 ${CX - 48} 96 ${CX - 48} 122 M${CX + 34} 30 C${CX + 44} 62 ${CX + 48} 96 ${CX + 48} 122`, hL, 0.35)}` })}<circle cx="${CX}" cy="26" r="6.5" fill="${hD}"/><circle cx="${CX - 2}" cy="24" r="2.4" fill="#fff" opacity=".3"/>${LOGO(CX, 54, 54, capInk)}<path d="${capBrim}" fill="#000" opacity=".35" transform="translate(0 4)" filter="url(#${u}b2)"/><path d="${capBrim}" fill="${sh(htc, -0.12)}"/>${hs(capBrim, { edge: 6, extra: `<path d="M${CX - hw} 122 C${CX - 60} 108 ${CX + 60} 108 ${CX + hw} 122" stroke="#000" stroke-width="7" opacity=".35" fill="none" filter="url(#${u}b2)"/>${st2(`M${CX - hw + 2} 128 C${CX - 50} 116 ${CX + 50} 116 ${CX + hw - 2} 128`)}${st2(`M${CX - hw + 8} 136 C${CX - 50} 124 ${CX + 50} 124 ${CX + hw - 8} 136`)}${st2(`M${CX - hw + 16} 143 C${CX - 50} 132 ${CX + 50} 132 ${CX + hw - 16} 143`)}<path d="M${CX - hw + 2} 140 C${CX - 50} 156 ${CX + 50} 156 ${CX + hw - 2} 140" stroke="${sh(htc, -0.5)}" stroke-width="4" fill="none"/>` })}`,
      backcap: `<path d="${crown(114, 28)}" fill="${hf}"/>${hs(crown(114, 28), { extra: `<path d="M${CX - 30} 32 C${CX - 40} 60 ${CX - 42} 90 ${CX - 42} 114 M${CX + 30} 32 C${CX + 40} 60 ${CX + 42} 90 ${CX + 42} 114" stroke="${hD}" stroke-width="2.4" fill="none" opacity=".55"/>` })}<path d="M${CX - 66} 42 C${CX - 46} 18 ${CX + 46} 18 ${CX + 66} 42 C${CX + 40} 32 ${CX - 40} 32 ${CX - 66} 42Z" fill="${sh(htc, -0.4)}"/><path d="M${CX - 26} 114 C${CX - 26} 92 ${CX + 26} 92 ${CX + 26} 114Z" fill="${hc}"/><rect x="${CX - 30}" y="106" width="60" height="9" rx="4" fill="${sh(htc, -0.35)}"/><g fill="${sh(htc, -0.6)}">${[-20, -10, 0, 10, 20].map((dx) => `<circle cx="${CX + dx}" cy="110.5" r="1.8"/>`).join("")}</g><circle cx="${CX}" cy="30" r="5.5" fill="${hD}"/>`,
      beanie: `<path d="${beanieD}" fill="${hf}"/>${hs(beanieD, { knit: 1, extra: `<g stroke="${hD}" stroke-width="3" opacity=".42" fill="none">${Array.from({ length: 15 }, (_, i) => { const dx = -98 + i * 14; return `<path d="M${CX + dx * 0.55} 26 C${CX + dx * 0.85} 50 ${CX + dx} 80 ${CX + dx} 104"/>`; }).join("")}</g><g stroke="${hL}" stroke-width="1.6" opacity=".3" fill="none">${Array.from({ length: 15 }, (_, i) => { const dx = -92 + i * 14; return `<path d="M${CX + dx * 0.55} 28 C${CX + dx * 0.85} 52 ${CX + dx} 80 ${CX + dx} 104"/>`; }).join("")}</g>` })}<path d="M${CX - hw - 13} 96 C${CX - 60} 86 ${CX + 60} 86 ${CX + hw + 13} 96 L${CX + hw + 12} 128 C${CX + 60} 120 ${CX - 60} 120 ${CX - hw - 12} 128Z" fill="${sh(htc, -0.1)}"/>${hs(`M${CX - hw - 13} 96 C${CX - 60} 86 ${CX + 60} 86 ${CX + hw + 13} 96 L${CX + hw + 12} 128 C${CX + 60} 120 ${CX - 60} 120 ${CX - hw - 12} 128Z`, { knit: 1, edge: 6, extra: `<g stroke="${sh(htc, -0.42)}" stroke-width="3.2" opacity=".55">${Array.from({ length: 22 }, (_, i) => { const x = CX - hw - 10 + i * ((2 * hw + 20) / 21); return `<path d="M${x.toFixed(1)} ${(92 - Math.cos(((x - CX) / (hw + 12)) * 1.4) * 4).toFixed(1)} v34"/>`; }).join("")}</g><path d="M${CX - hw - 12} 97 C${CX - 60} 87 ${CX + 60} 87 ${CX + hw + 12} 97" stroke="#fff" stroke-width="2" opacity=".28" fill="none"/>` })}`,
      bucket: `<path d="${bucketCrown}" fill="${hf}"/>${hs(bucketCrown, { extra: `<path d="M${CX - 50} 40 C${CX - 20} 30 ${CX + 20} 30 ${CX + 50} 40" stroke="${hD}" stroke-width="2" fill="none" opacity=".5"/>${st2(`M${CX - hw - 2} 98 C${CX - 40} 88 ${CX + 40} 88 ${CX + hw + 2} 98`)}` })}<path d="${bucketBrim}" fill="${hD}"/>${hs(bucketBrim, { edge: 5, extra: `${st2(`M${CX - hw - 18} 118 C${CX - 50} 108 ${CX + 50} 108 ${CX + hw + 18} 118`)}${st2(`M${CX - hw - 26} 128 C${CX - 50} 116 ${CX + 50} 116 ${CX + hw + 26} 128`)}${st2(`M${CX - hw - 32} 137 C${CX - 50} 125 ${CX + 50} 125 ${CX + hw + 32} 137`)}` })}`,
      fedora: `<ellipse cx="${CX}" cy="110" rx="${hw + 52}" ry="17" fill="${hD}"/>${hs(`M${CX - hw - 52} 110 A${hw + 52} 17 0 1 0 ${CX + hw + 52} 110 A${hw + 52} 17 0 1 0 ${CX - hw - 52} 110Z`, { edge: 5 })}<path d="${fedCrown}" fill="${hf}"/>${hs(fedCrown, { extra: `<path d="M${CX - 26} 44 C${CX - 14} 34 ${CX + 14} 34 ${CX + 26} 44" stroke="${hD}" stroke-width="5" fill="none" opacity=".7" filter="url(#${u}b1)"/><path d="M${CX - 46} 70 C${CX - 40} 52 ${CX - 30} 44 ${CX - 22} 42 M${CX + 46} 70 C${CX + 40} 52 ${CX + 30} 44 ${CX + 22} 42" stroke="${hD}" stroke-width="4" fill="none" opacity=".45" filter="url(#${u}b1)"/>` })}<rect x="${CX - hw + 6}" y="88" width="${2 * hw - 12}" height="16" fill="${t2}"/><rect x="${CX - hw + 6}" y="88" width="${2 * hw - 12}" height="4" fill="#fff" opacity=".2"/><path d="M${CX - hw - 48} 113 C${CX - 40} 128 ${CX + 40} 128 ${CX + hw + 48} 113" stroke="${hL}" stroke-width="2" fill="none" opacity=".45"/>`,
      cowboy: `<path d="M${CX - hw - 70} 92 C${CX - hw - 60} 130 ${CX - 40} 124 ${CX} 124 C${CX + 40} 124 ${CX + hw + 60} 130 ${CX + hw + 70} 92 C${CX + hw + 40} 112 ${CX - hw - 40} 112 ${CX - hw - 70} 92Z" fill="${hD}"/><path d="M${CX - hw + 6} 112 C${CX - hw + 2} 60 ${CX - 50} 20 ${CX - 20} 30 C${CX - 8} 44 ${CX + 8} 44 ${CX + 20} 30 C${CX + 50} 20 ${CX + hw - 2} 60 ${CX + hw - 6} 112Z" fill="${hf}"/>${hs(`M${CX - hw + 6} 112 C${CX - hw + 2} 60 ${CX - 50} 20 ${CX - 20} 30 C${CX - 8} 44 ${CX + 8} 44 ${CX + 20} 30 C${CX + 50} 20 ${CX + hw - 2} 60 ${CX + hw - 6} 112Z`)}<rect x="${CX - hw + 4}" y="92" width="${2 * hw - 8}" height="12" fill="${sh(htc, -0.45)}"/><circle cx="${CX}" cy="98" r="7" fill="url(#${u}mt)"/>`,
      visor: (() => { const band = `M${CX - hw - 8} 96 C${CX - 60} 88 ${CX + 60} 88 ${CX + hw + 8} 96 L${CX + hw + 8} 118 C${CX + 60} 110 ${CX - 60} 110 ${CX - hw - 8} 118Z`; const br = capBrim.replace(/ 1(16|40|56|57) /g, (m, v) => ` ${+("1" + v) - 2} `); return `<path d="${band}" fill="${hf}"/>${hs(band, { edge: 5 })}<path d="${br}" fill="#000" opacity=".35" transform="translate(0 4)" filter="url(#${u}b2)"/><path d="${br}" fill="${sh(htc, -0.12)}"/>${hs(br, { edge: 6, extra: `${st2(`M${CX - hw + 2} 126 C${CX - 50} 114 ${CX + 50} 114 ${CX + hw - 2} 126`)}${st2(`M${CX - hw + 10} 134 C${CX - 50} 122 ${CX + 50} 122 ${CX + hw - 10} 134`)}<path d="M${CX - hw + 2} 138 C${CX - 50} 154 ${CX + 50} 154 ${CX + hw - 2} 138" stroke="${sh(htc, -0.5)}" stroke-width="4" fill="none"/>` })}${LOGO(CX, 92, 26, capInk)}`; })(),
      headband: `<rect x="${CX - hw - 6}" y="102" width="${2 * hw + 12}" height="22" rx="11" fill="${hf}"/>${hs(`M${CX - hw - 6} 102 h${2 * hw + 12} v22 h${-(2 * hw + 12)}Z`, { knit: 1, edge: 4 })}<path d="M${CX - hw} 108 H${CX + hw}" stroke="#fff" stroke-width="3" opacity=".35"/>`,
      beret: (() => { const B = `M${CX - hw - 10} 112 C${CX - hw - 26} 70 ${CX - 70} 30 ${CX + 10} 30 C${CX + 90} 30 ${CX + hw + 40} 66 ${CX + hw + 14} 104 C${CX + 60} 96 ${CX - 60} 100 ${CX - hw - 10} 112Z`; return `<path d="${B}" fill="${hf}"/>${hs(B, { knit: 1, edge: 12 })}<path d="M${CX - hw - 6} 112 C${CX - 60} 98 ${CX + 60} 94 ${CX + hw + 10} 104" stroke="${hD}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M${CX + 6} 32 l3 -10" stroke="${hD}" stroke-width="5" stroke-linecap="round"/>`; })(),
      headphones: `<path d="${hpBand}" stroke="${sh(htc, -0.35)}" stroke-width="13" fill="none"/><path d="${hpBand}" stroke="${htc}" stroke-width="9" fill="none"/><path d="${hpBand}" stroke="#fff" stroke-width="2.5" fill="none" opacity=".3" transform="translate(-2 -2)"/>${cup(-1, 34, 60)}${cup(1, 34, 60)}`,
      headset: (() => { const x0 = CX - hw - 10, mx = CX - 22 * G.mw, myy = my + 6; const arm = `M${x0 + 4} 222 C${x0 + 8} 262 ${CX - 70} ${myy + 6} ${mx - 10} ${myy}`; return `<path d="${hpBand}" stroke="#1C1D22" stroke-width="9" fill="none"/><path d="${hpBand}" stroke="#4A4D57" stroke-width="3" fill="none" opacity=".7" transform="translate(-1 -2)"/>${cup(-1, 30, 52)}<rect x="${CX + hw + 2}" y="196" width="14" height="30" rx="7" fill="#1C1D22"/><path d="${arm}" stroke="#121318" stroke-width="5" fill="none" stroke-linecap="round"/><path d="${arm}" stroke="#5A5F6E" stroke-width="1.6" fill="none" opacity=".8" stroke-linecap="round" transform="translate(-.5 -1.2)"/><circle cx="${x0 + 4}" cy="222" r="6" fill="#2B2D36"/><circle cx="${x0 + 3}" cy="220.5" r="2" fill="#fff" opacity=".35"/><ellipse cx="${mx - 4}" cy="${myy}" rx="10" ry="7.5" fill="#15161B"/><ellipse cx="${mx - 4}" cy="${myy}" rx="10" ry="7.5" fill="url(#${u}mfoam)"/><ellipse cx="${mx - 7}" cy="${myy - 3}" rx="4" ry="2.2" fill="#fff" opacity=".18"/>`; })(),
      durag: (() => { const D = `M${CX - hw - 6} 140 C${CX - hw - 12} 60 ${CX - 56} 24 ${CX} 24 C${CX + 56} 24 ${CX + hw + 12} 60 ${CX + hw + 6} 140 C${CX + hw - 6} 122 ${CX + 60} 108 ${CX} 108 C${CX - 60} 108 ${CX - hw + 6} 122 ${CX - hw - 6} 140Z`; return `<path d="${D}" fill="${hf}"/>${hs(D, { edge: 8, extra: `<path d="M${CX} 26 C${CX - 2} 60 ${CX - 2} 90 ${CX} 108" stroke="${hD}" stroke-width="2.4" fill="none" opacity=".7"/><path d="M${CX - 60} 60 C${CX - 30} 36 ${CX + 6} 34 ${CX + 30} 44" stroke="#fff" stroke-width="16" fill="none" opacity=".35" filter="url(#${u}b8)"/><path d="M${CX - 50} 62 C${CX - 26} 44 ${CX - 4} 40 ${CX + 16} 44" stroke="#fff" stroke-width="3" fill="none" opacity=".45" filter="url(#${u}b1)"/><path d="M${CX - hw + 4} 126 C${CX - 50} 112 ${CX + 50} 112 ${CX + hw - 4} 126" stroke="${hD}" stroke-width="8" fill="none" opacity=".55"/>` })}`; })(),
      crown: (() => { const B = `M${CX - 64} 72 L${CX - 70} 26 L${CX - 40} 50 L${CX - 20} 12 L${CX} 44 L${CX + 20} 12 L${CX + 40} 50 L${CX + 70} 26 L${CX + 64} 72Z`; return `<g transform="translate(0 16) rotate(-6 ${CX} 60) translate(${CX} 60) scale(.9) translate(${-CX} -60)"><path d="${B}" fill="#000" opacity=".3" filter="url(#${u}b2)" transform="translate(0 4)"/><path d="${B}" fill="url(#${u}mt)" stroke="${sh(METAL[c.metal] ? METAL[c.metal][1] : "#C9962E", -0.2)}" stroke-width="2" stroke-linejoin="round"/><rect x="${CX - 66}" y="62" width="132" height="14" rx="4" fill="url(#${u}mt)" stroke="${sh(METAL[c.metal] ? METAL[c.metal][1] : "#C9962E", -0.25)}" stroke-width="1.5"/>${[[-70, 26], [-20, 12], [20, 12], [70, 26]].map(([dx, y]) => `<circle cx="${CX + dx}" cy="${y}" r="5" fill="url(#${u}mt)"/><circle cx="${CX + dx - 1.5}" cy="${y - 1.5}" r="1.6" fill="#fff"/>`).join("")}${[[-40, 69, t2], [0, 69, "#E5383B"], [40, 69, t2]].map(([dx, y, col]) => `<ellipse cx="${CX + dx}" cy="${y}" rx="7" ry="5" fill="${col}"/><ellipse cx="${CX + dx - 2}" cy="${y - 1.6}" rx="2.4" ry="1.4" fill="#fff" opacity=".8"/>`).join("")}<circle cx="${CX}" cy="48" r="6" fill="#3D8BFF"/><circle cx="${CX - 2}" cy="46" r="2" fill="#fff" opacity=".8"/><path d="M${CX - 58} 40 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3z" fill="#fff" opacity=".9"/></g>`; })(),
    };
    hdefs2 += `<pattern id="${u}mfoam" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#3A3D47"/></pattern>`;
    // earphones (sit in the ear, under long hair)
    const budsArt = (() => {
      if (c.buds !== "airpods" && c.buds !== "earpods") return "";
      const one = (s) => { const x = CX + s * (hw + 1), y = 206; return `<g filter="url(#${u}ds2)"><ellipse cx="${x}" cy="${y}" rx="9.5" ry="8.5" fill="#F4F5F7"/><path d="M${x + s * 1} ${y + 4} C${x + s * 1.5} ${y + 14} ${x + s * 0.5} ${y + 24} ${x - s * 0.5} ${y + 32}" stroke="#ECEDF0" stroke-width="6.5" fill="none" stroke-linecap="round"/><path d="M${x + s * 2.5} ${y + 6} C${x + s * 3} ${y + 14} ${x + s * 2} ${y + 24} ${x + s * 1.2} ${y + 31}" stroke="#B9BCC4" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/><ellipse cx="${x - s * 2}" cy="${y - 2}" rx="4" ry="3" fill="#fff"/><circle cx="${x + s * 4}" cy="${y - 1}" r="1.6" fill="#2B2D36" opacity=".7"/></g>`; };
      let wire = "";
      if (c.buds === "earpods") { const L = `M${CX - hw - 0.5} 238 C${CX - hw + 4} 270 ${CX - nw - 6} 300 ${CX - 12} 340 C${CX - 6} 350 ${CX - 2} 356 ${CX} 362`, Rr = mir(L); wire = `<g fill="none" stroke-linecap="round"><path d="${L} ${Rr} M${CX} 362 C${CX + 1} 390 ${CX - 2} 420 ${CX} 470" stroke="#000" stroke-width="3" opacity=".18" transform="translate(1 2)" filter="url(#${u}b1)"/><path d="${L} ${Rr} M${CX} 362 C${CX + 1} 390 ${CX - 2} 420 ${CX} 470" stroke="#F1F2F4" stroke-width="2.2"/></g><rect x="${CX - 3}" y="360" width="6" height="12" rx="3" fill="#E6E7EB"/>`; }
      return one(-1) + one(1) + wire;
    })();
    // joint in the corner of the mouth, with a lit tip and smoke
    const smokeArt = (() => {
      const k = c.smoke; if (!["joint", "cigar", "toothpick", "lollipop"].includes(k)) return "";
      const x0 = CX + 16 * G.mw, y0 = my + 4;
      const a = { joint: 0.24, cigar: 0.3, toothpick: -0.12, lollipop: 0.5 }[k], L = { joint: 60, cigar: 56, toothpick: 34, lollipop: 50 }[k];
      const tx = x0 + Math.cos(a) * L, ty = y0 + Math.sin(a) * L, rot = ((a * 180) / Math.PI).toFixed(1);
      const lit = k === "joint" || k === "cigar";
      const wisp = `M${tx + 2} ${ty - 6} C${tx - 8} ${ty - 30} ${tx + 16} ${ty - 44} ${tx + 4} ${ty - 70} C${tx - 6} ${ty - 92} ${tx + 18} ${ty - 104} ${tx + 10} ${ty - 128}`;
      const wisp2 = `M${tx + 4} ${ty - 8} C${tx + 18} ${ty - 28} ${tx + 2} ${ty - 50} ${tx + 20} ${ty - 76}`;
      const defs2 = `<defs><linearGradient id="${u}jp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F1EEE6"/><stop offset="1" stop-color="#CFC9BC"/></linearGradient><linearGradient id="${u}cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9A6338"/><stop offset=".5" stop-color="#6E4122"/><stop offset="1" stop-color="#3E2312"/></linearGradient><radialGradient id="${u}jem" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFE38A"/><stop offset=".45" stop-color="#FF7A1F"/><stop offset="1" stop-color="#B8320E"/></radialGradient><radialGradient id="${u}lol" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="${sh(t2, 0.45)}"/><stop offset="1" stop-color="${sh(t2, -0.2)}"/></radialGradient></defs>`;
      const shadow = `<path d="M${x0} ${y0 + 5} l${(Math.cos(a) * L).toFixed(1)} ${(Math.sin(a) * L + 3).toFixed(1)}" stroke="#000" stroke-width="${k === "cigar" ? 11 : k === "toothpick" ? 3 : 7}" opacity=".2" filter="url(#${u}b2)"/>`;
      const ember = `<ellipse cx="${L - 1}" cy="0" rx="${k === "cigar" ? 5 : 3.4}" ry="${k === "cigar" ? 7 : 4.6}" fill="url(#${u}jem)"/><ellipse cx="${L + 1}" cy="0" rx="8" ry="9" fill="#FF7A1F" opacity=".35" filter="url(#${u}b2)"/>`;
      const item = {
        joint: `<path d="M-2 -2.8 L${L - 6} -4.6 C${L - 3} -4.6 ${L - 1} -2 ${L} 0 C${L - 1} 2 ${L - 3} 4.6 ${L - 6} 4.6 L-2 2.8Z" fill="url(#${u}jp)"/><rect x="-2" y="-2.9" width="11" height="5.8" rx="1.2" fill="#D9B98A"/><path d="M1 -2.6 v5.2 M4 -2.7 v5.4 M7 -2.8 v5.6" stroke="#B8955F" stroke-width=".8"/><path d="M14 -3.3 l2 6.8 M24 -3.6 l2 7.3 M36 -4 l2 8" stroke="#D8D2C4" stroke-width=".9"/><path d="M${L - 9} -4.6 C${L - 4} -4.6 ${L - 1} -2 ${L} 0 C${L - 1} 2 ${L - 4} 4.6 ${L - 9} 4.6Z" fill="#8E8A84"/>${ember}`,
        cigar: `<rect x="-3" y="-7" width="${L + 2}" height="14" rx="6" fill="url(#${u}cg)"/><path d="M4 -6 Q${L / 2} -9 ${L - 4} -6" stroke="#C48A55" stroke-width="1.5" fill="none" opacity=".6"/><rect x="10" y="-7.4" width="10" height="14.8" rx="1.5" fill="#C9A24A"/><rect x="10" y="-7.4" width="10" height="4" fill="#fff" opacity=".35"/><rect x="13" y="-3" width="4" height="6" fill="#8C2F23"/><rect x="${L - 8}" y="-7" width="8" height="14" rx="3" fill="#7E7A74"/>${ember}`,
        toothpick: `<path d="M-2 -1.4 L${L} -0.4 L${L} 0.4 L-2 1.4Z" fill="#E8C98E" stroke="#B8955F" stroke-width=".5"/>`,
        lollipop: `<path d="M-2 -1.8 L${L - 12} -1.8 L${L - 12} 1.8 L-2 1.8Z" fill="#F7F7F7" stroke="#D5D5D5" stroke-width=".6"/><circle cx="${L + 3}" cy="0" r="19" fill="#000" opacity=".25" filter="url(#${u}b2)" transform="translate(1 3)"/><circle cx="${L + 3}" cy="0" r="18" fill="url(#${u}lol)"/><path d="M${L + 3} 0 m-12 0 a12 12 0 1 1 12 12 a8 8 0 1 1 -8 -8 a4 4 0 1 1 4 4" fill="none" stroke="#fff" stroke-width="2.6" opacity=".7"/><ellipse cx="${L - 3}" cy="-8" rx="5" ry="3" fill="#fff" opacity=".7"/>`,
      }[k];
      const smoke = lit ? `<g fill="none" stroke-linecap="round" filter="url(#${u}b2)"><path d="${wisp}" stroke="#E9EAF0" stroke-width="5" opacity=".42"/><path d="${wisp2}" stroke="#E9EAF0" stroke-width="3.5" opacity=".3"/></g><g fill="none" stroke-linecap="round" filter="url(#${u}b4)"><path d="${wisp}" stroke="#fff" stroke-width="12" opacity=".14"/></g>` : "";
      return defs2 + shadow + `<g transform="translate(${x0.toFixed(1)} ${y0.toFixed(1)}) rotate(${rot})">${item}</g>` + smoke;
    })();
    const brimY = { cap: 146, fedora: 124, cowboy: 124, bucket: 136, visor: 134, beanie: 128, backcap: 118, beret: 104 }[c.hat];
    const brimShadow = brimY ? `<g clip-path="url(#${u}fc)"><ellipse cx="${CX}" cy="${brimY}" rx="${hw + 14}" ry="${c.hat === "cap" || c.hat === "visor" ? 24 : 16}" fill="#000" opacity="${c.hat === "beanie" || c.hat === "backcap" || c.hat === "beret" ? 0.22 : 0.38}" filter="url(#${u}b8)"/></g>` : "";
    const hatArt = HATS[c.hat] || "";
    defs = defs.replace("</defs>", hdefs2 + "</defs>");

    /* ---- assemble ---- */
    const head = `${ears}${c.earrings !== "none" ? earrings : ""}<path d="${FP}" fill="url(#${u}sk)"/>${faceShade}${ageArt}${blushArt}${freckleArt}${moleArt}${beardArt}${hairShadow}${eyesArt}${browsArt}${noseArt}${mouthArt}${beardTop}${beardTex}${pierceArt}`;
    const hoodBack = c.top === "hoodie" ? `<path d="M${CX - nw - 40} 352 C${CX - nw - 46} 316 ${CX - 34} 292 ${CX} 292 C${CX + 34} 292 ${CX + nw + 46} 316 ${CX + nw + 40} 352 Z" fill="${tcD}"/>` : "";
    const knitTop = ["sweater", "turtleneck"].includes(c.top);
    const outerClip = ["bomber", "puffer"].includes(c.outer) ? torso : `${panelL} ${mir(panelL)}`;
    const topTex = `<g clip-path="url(#${u}tc)"><rect x="0" y="270" width="400" height="360" filter="url(#${u}${knitTop ? "knit" : "fab"})" opacity="${knitTop ? 0.5 : 0.24}" style="mix-blend-mode:soft-light"/></g>`;
    const outerTex = ["none", "puffer", "furcoat"].includes(c.outer) ? "" : `<g clip-path="url(#${u}oc)">${c.outer === "denim" ? `<rect x="0" y="280" width="400" height="300" fill="url(#${u}den)"/>` : ""}${c.outer === "leather" ? `<g filter="url(#${u}b4)" opacity=".5"><path d="M${CX - SW + 20} 400 C${CX - 110} 380 ${CX - 80} 376 ${CX - 60} 380" stroke="#fff" stroke-width="8" fill="none" opacity=".35"/><path d="M${CX + SW - 30} 420 C${CX + 110} 404 ${CX + 90} 400 ${CX + 70} 404" stroke="#fff" stroke-width="6" fill="none" opacity=".25"/></g>` : `<rect x="0" y="280" width="400" height="300" filter="url(#${u}${c.outer === "cardigan" ? "knit" : "fab"})" opacity="${c.outer === "cardigan" ? 0.5 : 0.35}" style="mix-blend-mode:soft-light"/>`}</g>`;
    const shoulders = `<g clip-path="url(#${u}tor)"><ellipse cx="${CX - SW + 46}" cy="388" rx="54" ry="26" fill="#fff" opacity=".13" filter="url(#${u}b8)"/><ellipse cx="${CX + SW - 46}" cy="388" rx="54" ry="26" fill="#fff" opacity=".07" filter="url(#${u}b8)"/><path d="M${CX - SW + 42} 410 C${CX - SW + 50} 440 ${CX - SW + 50} 470 ${CX - SW + 46} 520" stroke="#000" stroke-width="14" opacity=".18" fill="none" filter="url(#${u}b8)"/><path d="M${CX + SW - 42} 410 C${CX + SW - 50} 440 ${CX + SW - 50} 470 ${CX + SW - 46} 520" stroke="#000" stroke-width="14" opacity=".24" fill="none" filter="url(#${u}b8)"/></g>`;
    const body = `<g transform="translate(0 -12)">${hoodBack}${neck}<g filter="url(#${u}ds)">${topArt}</g>${topTex}${neckUnder ? `<g filter="url(#${u}ds)">${neckArt}</g>` : ""}${outerArt ? `<g filter="url(#${u}ds)">${outerArt}</g>` : ""}${outerTex}${!neckUnder ? `<g filter="url(#${u}ds)">${neckArt}</g>` : ""}${shoulders}<g clip-path="url(#${u}tor)"><path d="${torso}" fill="url(#${u}cv)"/><path d="${torso}" fill="url(#${u}cy)"/><ellipse cx="${CX}" cy="342" rx="${nw + 46}" ry="18" fill="#000" opacity=".28" filter="url(#${u}b8)"/></g></g>`;
    const Fl = (id, sd) => `<filter id="${u}${id}" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
    defs = defs.replace("</defs>", `${Fl("b05", 0.5)}${Fl("b1", 0.9)}${Fl("b2", 2)}${Fl("b4", 4)}${Fl("b8", 8)}${Fl("b14", 14)}
<radialGradient id="${u}hv" gradientUnits="userSpaceOnUse" cx="${CX - 34}" cy="58" r="200"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
<linearGradient id="${u}cv" gradientUnits="userSpaceOnUse" x1="${CX - SW - 20}" y1="0" x2="${CX + SW + 20}" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".4" stop-color="#fff" stop-opacity=".1"/><stop offset=".68" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".48"/></linearGradient>
<linearGradient id="${u}cy" gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="560"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
<radialGradient id="${u}sc" cx=".46" cy=".42" r=".62"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".65" stop-color="#F3F0F6"/><stop offset="1" stop-color="#CFC6D3"/></radialGradient>
<linearGradient id="${u}lp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh(lip, -0.18)}"/><stop offset="1" stop-color="${sh(lip, 0.14)}"/></linearGradient>
<linearGradient id="${u}bw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${sh(brc, 0.1)}"/><stop offset="1" stop-color="${sh(brc, -0.15)}"/></linearGradient>
<radialGradient id="${u}er" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="${sk}"/><stop offset="1" stop-color="${skDD}"/></radialGradient>
<radialGradient id="${u}vg" cx=".5" cy=".42" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></radialGradient>
<clipPath id="${u}nkc"><path d="${neckD}"/></clipPath><clipPath id="${u}tc"><path d="${torso}"/>${c.top === "turtleneck" ? `<rect x="${CX - nw - 12}" y="286" width="${2 * nw + 24}" height="80"/>` : ""}</clipPath><clipPath id="${u}oc"><path d="${outerClip}"/></clipPath>
<filter id="${u}ds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity=".4"/></filter>
<filter id="${u}ds2" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1" dy="5" stdDeviation="2.5" flood-color="#000" flood-opacity=".28"/></filter>
<filter id="${u}fab" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.25" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
<filter id="${u}knit" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".09 .55" numOctaves="2" seed="9"/><feColorMatrix type="saturate" values="0"/></filter>
<pattern id="${u}den" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="2.2" height="5" fill="#fff" opacity=".1"/><rect x="2.6" width="1" height="5" fill="#000" opacity=".12"/></pattern>
<style>.${u}w *{fill:#fff!important;stroke:#fff!important}.${u}w [fill="none"]{fill:none!important}</style></defs>`);
    const backdrop = opts.noBg ? "" : `<g filter="url(#${u}b14)" opacity=".38"><ellipse cx="${CX + 14}" cy="470" rx="${SW + 30}" ry="90" fill="#000"/><ellipse cx="${CX + 12}" cy="190" rx="${hw + 26}" ry="128" fill="#000" opacity=".35"/></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${W}" height="${Hh}" ${opts.slice ? 'preserveAspectRatio="xMidYMid slice"' : ""} role="img" aria-label="${esc(opts.label || "Character")}">${defs}${bgArt}${opts.noBg ? "" : `<rect x="-60" y="-60" width="520" height="680" fill="url(#${u}vg)"/>`}${backdrop}${hairBackArt}${hairBackVol}${body}${head}${budsArt}${hairFrontArt}${hairVol}${brimShadow}${smokeArt}${glassesArt ? `<g filter="url(#${u}ds2)">${glassesArt}</g>` : ""}${hatArt ? `<g filter="url(#${u}ds)">${hatArt}</g>` : ""}</svg>`;
    return svg;
  }

  /* ======================= character creator ======================= */
  const ICON = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    face: ICON('<path d="M12 3c4.4 0 7 3.4 7 8 0 5-3.2 10-7 10s-7-5-7-10c0-4.6 2.6-8 7-8z"/><path d="M9.5 11h.01M14.5 11h.01M10 15.5c1.2.8 2.8.8 4 0"/>'),
    skin: ICON('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    hair: ICON('<path d="M5 14c0-6 3-10 7-10s7 4 7 10"/><path d="M5 14c2-4 5-5.5 9-5 2 .3 3.5 1.6 5 5"/><path d="M6 14v5M18 14v5"/>'),
    eyes: ICON('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    brows: ICON('<path d="M3 11c3-3 6-3.5 9-2M13 9c3-1.5 6-1 8 2"/><path d="M6 16h.01M18 16h.01"/>'),
    nose: ICON('<path d="M12 4v9l-3 3.5c1.6 1.4 4.4 1.4 6 0"/>'),
    mouth: ICON('<path d="M4 11c3 5 13 5 16 0"/><path d="M4 11c4 1.5 12 1.5 16 0"/>'),
    beard: ICON('<path d="M5 9c0 7 3.5 12 7 12s7-5 7-12"/><path d="M8.5 13c2-1.5 5-1.5 7 0"/>'),
    makeup: ICON('<path d="M9 21V11l3-7 3 7v10z"/><path d="M9 14h6"/>'),
    details: ICON('<path d="M12 3l2.4 5 5.6.8-4 3.9 1 5.5L12 15.6 7 18.2l1-5.5-4-3.9 5.6-.8z"/>'),
    glasses: ICON('<circle cx="6.5" cy="13" r="3.5"/><circle cx="17.5" cy="13" r="3.5"/><path d="M10 13h4M3 13 2 9M21 13l1-4"/>'),
    hat: ICON('<path d="M4 15c0-6 3.5-9 8-9s8 3 8 9z"/><path d="M2 15h20"/>'),
    top: ICON('<path d="M8 4 3 8l3 3 2-2v11h8V9l2 2 3-3-5-4c-1 2-2.4 3-4 3S9 6 8 4z"/>'),
    outer: ICON('<path d="M8 4 3 8v12h6V9M16 4l5 4v12h-6V9"/><path d="m8 4 4 6 4-6"/>'),
    extras: ICON('<path d="M7 7c0 7 10 7 10 0"/><path d="M12 13.5v3"/><circle cx="12" cy="18.5" r="2"/>'),
    bg: ICON('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>'),
    name: ICON('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M7 11h6M7 15h10"/>'),
    undo: ICON('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: ICON('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    dice: ICON('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>'),
    x: ICON('<path d="M6 6l12 12M18 6 6 18"/>'),
    zoom: ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>'),
    body: ICON('<circle cx="12" cy="6" r="3"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8"/>'),
    plus: ICON('<path d="M12 5v14M5 12h14"/>'),
    reset: ICON('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  };
  const CATS = [
    { id: "face", label: "Face", zoom: "head", sec: [{ t: "tiles", key: "face", title: "Face shape", crop: "head" }, { t: "sliders", title: "Shape it", items: [["headW", "Face width"], ["jaw", "Jaw"], ["chin", "Chin length"], ["ears", "Ears"]] }] },
    { id: "skin", label: "Skin", zoom: "head", sec: [{ t: "colors", key: "skin", title: "Skin tone", pal: "skin" }] },
    { id: "hair", label: "Hair", zoom: "head", sec: [{ t: "tiles", key: "hair", title: "Hairstyle", crop: "head" }, { t: "colors", key: "hairColor", title: "Hair color", pal: "hair" }] },
    { id: "eyes", label: "Eyes", zoom: "head", sec: [{ t: "tiles", key: "eyes", title: "Eye shape", crop: "eyes" }, { t: "colors", key: "eyeColor", title: "Eye color", pal: "eye" }, { t: "sliders", title: "Fine-tune", items: [["eyeSize", "Size"], ["eyeGap", "Spacing"], ["eyeY", "Height"], ["eyeTilt", "Tilt"]] }] },
    { id: "brows", label: "Brows", zoom: "head", sec: [{ t: "tiles", key: "brows", title: "Brow shape", crop: "eyes" }, { t: "colors", key: "browColor", title: "Brow color", pal: "hair", auto: "Match hair" }, { t: "sliders", title: "Fine-tune", items: [["browY", "Height"], ["browW", "Thickness"]] }] },
    { id: "nose", label: "Nose", zoom: "head", sec: [{ t: "tiles", key: "nose", title: "Nose", crop: "face" }, { t: "sliders", title: "Fine-tune", items: [["noseSize", "Size"], ["noseY", "Height"]] }] },
    { id: "mouth", label: "Mouth", zoom: "head", sec: [{ t: "tiles", key: "mouth", title: "Expression", crop: "mouth" }, { t: "sliders", title: "Fine-tune", items: [["mouthW", "Width"], ["mouthY", "Height"], ["lips", "Lip fullness"]] }] },
    { id: "beard", label: "Facial hair", zoom: "head", sec: [{ t: "tiles", key: "beard", title: "Facial hair", crop: "beard" }, { t: "colors", key: "beardColor", title: "Color", pal: "hair", auto: "Match hair" }] },
    { id: "details", label: "Details", zoom: "head", sec: [{ t: "amount", key: "freckles", title: "Freckles" }, { t: "amount", key: "age", title: "Smile & age lines" }, { t: "tiles", key: "mole", title: "Beauty mark", crop: "face", few: true }, { t: "tiles", key: "piercing", title: "Piercings", crop: "face" }] },
    { id: "glasses", label: "Glasses", zoom: "head", sec: [{ t: "tiles", key: "glasses", title: "Glasses", crop: "head" }, { t: "colors", key: "glassColor", title: "Frame color", pal: "frame" }, { t: "colors", key: "lensColor", title: "Lens color", pal: "lens", auto: "Default" }] },
    { id: "hat", label: "Headwear", zoom: "bust", sec: [{ t: "tiles", key: "hat", title: "Headwear", crop: "hat" }, { t: "colors", key: "hatColor", title: "Color", pal: "cloth" }] },
    { id: "top", label: "Top", zoom: "bust", sec: [{ t: "tiles", key: "top", title: "Top", crop: "body" }, { t: "colors", key: "topColor", title: "Color", pal: "cloth" }, { t: "colors", key: "top2", title: "Accent color", pal: "cloth", small: true }] },
    { id: "outer", label: "Jacket", zoom: "bust", sec: [{ t: "tiles", key: "outer", title: "Jacket", crop: "body" }, { t: "colors", key: "outerColor", title: "Color", pal: "cloth" }] },
    { id: "extras", label: "Accessories", zoom: "bust", sec: [{ t: "tiles", key: "neck", title: "Neck", crop: "body" }, { t: "tiles", key: "earrings", title: "Earrings", crop: "head", few: true }, { t: "tiles", key: "buds", title: "Earphones", crop: "head", few: true }, { t: "tiles", key: "smoke", title: "In the mouth", crop: "face" }, { t: "tiles", key: "grill", title: "Grill", crop: "mouth", few: true }, { t: "chips", key: "metal", title: "Metal" }] },
    { id: "body", label: "Build", zoom: "bust", sec: [{ t: "sliders", title: "Build", items: [["build", "Shoulders"], ["neck", "Neck"]] }] },
    { id: "bg", label: "Background", zoom: "bust", sec: [{ t: "colors", key: "bgColor", title: "Background color", pal: "bg", set: ["bg", "solid"] }] },
    { id: "name", label: "Name tag", zoom: "bust", sec: [{ t: "name" }] },
  ];
  const CSS = `
.hpa{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;background:rgba(6,4,12,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:var(--f-ui,"Inter",system-ui,sans-serif);color:#F4F5F8;opacity:0;transition:opacity .2s}
.hpa.in{opacity:1}
.hpa *{box-sizing:border-box}
.hpa-sheet{width:min(1180px,calc(100vw - 24px));height:min(820px,calc(100vh - 24px));display:flex;flex-direction:column;border-radius:26px;overflow:hidden;background:linear-gradient(160deg,#1B0F2E 0%,#120A1F 55%,#0D0816 100%);border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(255,79,163,.08);transform:translateY(10px) scale(.985);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.hpa.in .hpa-sheet{transform:none}
.hpa-top{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.hpa-top h2{margin:0 auto 0 4px;font:800 19px/1.2 var(--f-head,var(--f-ui,system-ui));letter-spacing:-.01em}
.hpa-ib{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#E9EAF0;cursor:pointer;transition:background .15s,border-color .15s}
.hpa-ib svg{width:20px;height:20px}
.hpa-ib:hover:not(:disabled){background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22)}
.hpa-ib:disabled{opacity:.35;cursor:default}
.hpa-btn{height:40px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font:700 14px var(--f-ui,system-ui);cursor:pointer;white-space:nowrap}
.hpa-btn svg{width:18px;height:18px}
.hpa-btn:hover{background:rgba(255,255,255,.12)}
.hpa-btn.pri{border:0;background:linear-gradient(135deg,#FF4FA3,#FF9E3D);box-shadow:0 8px 24px rgba(255,79,163,.35)}
.hpa-btn.pri:hover{filter:brightness(1.07)}
.hpa-btn:disabled{opacity:.6;cursor:default}
.hpa-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,40%) 1fr}
.hpa-stage{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:22px;background:radial-gradient(70% 60% at 50% 45%,rgba(255,79,163,.16),transparent 70%);border-right:1px solid rgba(255,255,255,.07)}
.hpa-av{width:min(100%,380px);aspect-ratio:344/430;border-radius:28px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.12);background:#1a1026}
.hpa-av svg{display:block;width:100%;height:100%}
.hpa-av.pop{animation:hpaPop .28s cubic-bezier(.2,.9,.3,1.3)}
@keyframes hpaPop{0%{transform:scale(.97)}100%{transform:none}}
.hpa-views{display:flex;gap:8px}
.hpa-seg{display:inline-flex;padding:4px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.hpa-seg button{height:32px;padding:0 14px;white-space:nowrap;border:0;border-radius:9px;background:none;color:#C9CBD6;font:700 13px var(--f-ui,system-ui);cursor:pointer}
.hpa-seg button[aria-pressed="true"]{background:linear-gradient(135deg,#FF4FA3,#FF9E3D);color:#fff}
.hpa-edit{min-width:0;min-height:0;display:flex;flex-direction:column}
.hpa-cats{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:4px;padding:10px 12px;overflow-x:auto;scrollbar-width:thin;border-bottom:1px solid rgba(255,255,255,.07);flex:none}
.hpa-cat{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;padding:8px 6px 7px;border-radius:14px;border:1px solid transparent;background:none;color:#AEB2C0;font:700 11.5px var(--f-ui,system-ui);cursor:pointer;transition:background .15s,color .15s}
.hpa-cat svg{width:22px;height:22px}.hpa-cat span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hpa-cat:hover{background:rgba(255,255,255,.06);color:#fff}
.hpa-cat[aria-selected="true"]{background:linear-gradient(160deg,rgba(255,79,163,.24),rgba(255,158,61,.14));border-color:rgba(255,79,163,.45);color:#fff}
.hpa-panel{flex:1;min-height:0;overflow-y:auto;padding:6px 20px 28px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
.hpa-sec{padding-top:18px}
.hpa-sec h3{margin:0 0 10px;display:flex;align-items:center;gap:8px;font:800 12px var(--f-ui,system-ui);letter-spacing:.1em;text-transform:uppercase;color:#9EA3B3}
.hpa-sec h3 .r{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:700;color:#FF8CC6;background:none;border:0;cursor:pointer;font-size:12.5px;display:inline-flex;gap:5px;align-items:center}
.hpa-sec h3 .r svg{width:14px;height:14px}
.hpa-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
.hpa-tiles.few{grid-template-columns:repeat(auto-fill,minmax(104px,128px))}
.hpa-tile{position:relative;padding:0;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.08);background:#20142F;cursor:pointer;transition:transform .12s,border-color .15s,box-shadow .15s;text-align:center}
.hpa-tile svg{display:block;width:100%;height:auto;aspect-ratio:1}
.hpa-tiles.tall .hpa-tile svg{aspect-ratio:344/430}
.hpa-tile span{display:block;padding:6px 4px 7px;font:700 12px var(--f-ui,system-ui);color:#D7D9E2;background:rgba(10,6,18,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hpa-tile:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.25)}
.hpa-tile[aria-pressed="true"]{border-color:#FF4FA3;box-shadow:0 0 0 3px rgba(255,79,163,.28)}
.hpa-tile[aria-pressed="true"] span{background:linear-gradient(135deg,#FF4FA3,#FF7A5C);color:#fff}
.hpa-tile:focus-visible,.hpa-sw:focus-visible,.hpa-cat:focus-visible,.hpa-chip:focus-visible{outline:2px solid #3DF5FF;outline-offset:2px}
.hpa-sws{display:flex;flex-wrap:wrap;gap:9px}
.hpa-sw{position:relative;width:40px;height:40px;border-radius:50%;border:0;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),inset 0 -6px 10px rgba(0,0,0,.18);transition:transform .12s}
.hpa-sws.sm .hpa-sw{width:34px;height:34px}
.hpa-sw:hover{transform:scale(1.08)}
.hpa-sw[aria-pressed="true"]{box-shadow:0 0 0 3px #120A1F,0 0 0 5px #FF4FA3}
.hpa-sw[aria-pressed="true"]::after{content:"";position:absolute;inset:0;margin:auto;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.hpa-sw.custom{display:grid;place-items:center;background:conic-gradient(#FF4FA3,#FFD447,#2FBF71,#3DF5FF,#3D8BFF,#B15CFF,#FF4FA3);overflow:hidden}
.hpa-sw.custom svg{width:18px;height:18px;color:#fff;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.hpa-sw.custom input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;border:0;padding:0}
.hpa-chip{height:36px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#E4E6EE;font:700 13px var(--f-ui,system-ui);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.hpa-chip i{width:16px;height:16px;border-radius:50%;display:inline-block}
.hpa-chip[aria-pressed="true"]{border-color:#FF4FA3;background:rgba(255,79,163,.18);color:#fff}
.hpa-sl{display:grid;grid-template-columns:120px 1fr 44px;align-items:center;gap:12px;padding:7px 0}
.hpa-sl label{font:700 13.5px var(--f-ui,system-ui);color:#E4E6EE}
.hpa-sl output{font:700 12px var(--f-num,var(--f-ui,system-ui));color:#9EA3B3;text-align:right}
.hpa-range{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:none;cursor:pointer;--p:50%}
.hpa-range::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,#FF4FA3,#FF9E3D) 0/var(--p) 100% no-repeat,rgba(255,255,255,.12)}
.hpa-range::-moz-range-track{height:6px;border-radius:3px;background:rgba(255,255,255,.12)}
.hpa-range::-moz-range-progress{height:6px;border-radius:3px;background:linear-gradient(90deg,#FF4FA3,#FF9E3D)}
.hpa-range::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:#fff;border:0;box-shadow:0 2px 8px rgba(0,0,0,.45),0 0 0 4px rgba(255,79,163,.35)}
.hpa-range::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:0;box-shadow:0 2px 8px rgba(0,0,0,.45),0 0 0 4px rgba(255,79,163,.35)}
.hpa-range:focus-visible{outline:2px solid #3DF5FF;outline-offset:2px;border-radius:6px}
.hpa-field{display:flex;flex-direction:column;gap:7px;margin-bottom:16px}
.hpa-field span{font:700 13px var(--f-ui,system-ui);color:#C9CBD6}
.hpa-field input{height:46px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font:600 15px var(--f-ui,system-ui)}
.hpa-field input:focus{outline:none;border-color:#FF4FA3;box-shadow:0 0 0 3px rgba(255,79,163,.22)}
.hpa-note{font-size:12.5px;color:#9EA3B3;margin:0}
.hpa-err{color:#FF8CA8;font-size:13px;font-weight:700;min-height:18px}
.hpa-bm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;width:min(420px,calc(100% - 32px));padding:24px;border-radius:20px;background:rgba(20,12,32,.98);border:1px solid rgba(255,255,255,.16);box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center}
.hpa-bm h3{margin:0;font:800 19px var(--f-ui,system-ui)}
.hpa-bm p{margin:0;color:#C9CBD6;font-size:14px;line-height:1.45}
.hpa-snapbtn{min-height:48px;display:flex;justify-content:center}
.hpa-bmmsg{min-height:18px;font-weight:700;color:#FFD1EC!important}
.hpa-bmbar{position:absolute;left:16px;right:16px;bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-radius:14px;background:rgba(20,12,32,.92);border:1px solid rgba(255,255,255,.14);font-size:13px;font-weight:600;color:#E4E6EE;z-index:2}
.hpa-bmbar span{flex:1 1 180px}
.hpa-bmbar .hpa-btn{height:34px;font-size:13px;padding:0 12px}
.hpa-discard{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-radius:14px;background:rgba(20,12,32,.97);border:1px solid rgba(255,255,255,.14);box-shadow:0 16px 40px rgba(0,0,0,.5);font-weight:700;font-size:14px;z-index:3;white-space:nowrap}
@media (max-width:820px){
  .hpa-sheet{width:100vw;height:100dvh;border-radius:0;border:0}
  .hpa-top{padding:10px 12px;gap:6px}.hpa-top h2{font-size:16px}
  .hpa-btn.txt-sm span{display:none}.hpa-btn.txt-sm{padding:0 11px}
  .hpa-main{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  .hpa-stage{flex-direction:row;padding:12px;gap:12px;border-right:0;border-bottom:1px solid rgba(255,255,255,.07)}
  .hpa-av{width:auto;height:min(30vh,230px);border-radius:20px}
  .hpa-views{flex-direction:column}
  .hpa-cats{display:flex;padding:10px}.hpa-cat{min-width:66px}
  .hpa-panel{padding:4px 14px 24px}
  .hpa-tiles{grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
  .hpa-sl{grid-template-columns:96px 1fr 38px}
}
@media (prefers-reduced-motion:reduce){.hpa,.hpa-sheet,.hpa-tile,.hpa-sw{transition:none}.hpa-av.pop{animation:none}}`;

  function openCreator(o = {}) {
    if (!document.getElementById("hpa-style")) { const st = document.createElement("style"); st.id = "hpa-style"; st.textContent = CSS; document.head.append(st); }
    document.querySelector(".hpa")?.remove();
    const st = { c: migrate(o.char || random()), handle: o.handle || "", motto: o.motto || "", cat: "face", zoom: null, undo: [], redo: [], dirty: false };
    if (!o.char) st.cat = "skin";
    const root = document.createElement("div");
    root.className = "hpa"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Character creator");
    root.innerHTML = `<div class="hpa-sheet">
  <header class="hpa-top">
    <button class="hpa-ib" data-a="close" aria-label="Close">${I.x}</button>
    <h2>${esc(o.title || "Your character")}</h2>
    <button class="hpa-ib" data-a="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${I.undo}</button>
    <button class="hpa-ib" data-a="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${I.redo}</button>
    <button class="hpa-btn txt-sm" data-a="bitmoji" title="Use your Snapchat Bitmoji">${I.face}<span>Use my Bitmoji</span></button>
    <button class="hpa-btn txt-sm" data-a="rand" title="Random look">${I.dice}<span>Surprise me</span></button>
    <button class="hpa-btn pri" data-a="save">Save</button>
  </header>
  <div class="hpa-main">
    <section class="hpa-stage" aria-label="Preview">
      <div class="hpa-av" id="hpaAv"></div>
      <div class="hpa-views"><div class="hpa-seg" role="group" aria-label="Preview view"><button type="button" data-v="head">Close-up</button><button type="button" data-v="bust">Full</button></div></div>
    </section>
    <section class="hpa-edit">
      <nav class="hpa-cats" role="tablist" aria-label="What to change">${CATS.map((k) => `<button type="button" class="hpa-cat" role="tab" id="hpaTab-${k.id}" aria-controls="hpaPanel" data-cat="${k.id}">${I[k.id] || I.details}<span>${k.label}</span></button>`).join("")}</nav>
      <div class="hpa-panel" id="hpaPanel" role="tabpanel"></div>
    </section>
  </div></div>`;
    document.body.append(root);
    const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
    const prevFocus = document.activeElement;
    const tuneKey = (k) => TUNE.includes(k);
    const get = (k) => (tuneKey(k) ? +(st.c.tune?.[k] || 0) : st.c[k]);
    const snapshot = () => JSON.stringify(st.c);
    const push = () => { st.undo.push(snapshot()); if (st.undo.length > 80) st.undo.shift(); st.redo = []; st.dirty = true; };
    const setVal = (k, v, opts2 = {}) => {
      if (!opts2.noHistory) push();
      if (tuneKey(k) && !opts2.direct) st.c = { ...st.c, tune: { ...st.c.tune, [k]: v } }; else st.c = { ...st.c, [k]: v };
      if (opts2.also) for (const [kk, vv] of opts2.also) st.c[kk] = vv;
    };
    const cat = () => CATS.find((k) => k.id === st.cat) || CATS[0];
    const view = () => st.zoom || cat().zoom;
    let raf = 0;
    const paintAv = (pop) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const v = view(), av = $("#hpaAv");
        av.style.aspectRatio = v === "head" ? "1" : "344/430";
        av.innerHTML = render(st.c, 380, { crop: v === "head" ? "close" : v, slice: v === "head", label: "Your character preview" });
        const svg = av.querySelector("svg"); svg.removeAttribute("width"); svg.removeAttribute("height");
        if (pop) { av.classList.remove("pop"); void av.offsetWidth; av.classList.add("pop"); }
        $$(".hpa-seg [data-v]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
        $('[data-a="undo"]').disabled = !st.undo.length; $('[data-a="redo"]').disabled = !st.redo.length;
      });
    };
    const swatch = (color, on, lab) => `<button type="button" class="hpa-sw" data-col="${color}" aria-pressed="${on}" aria-label="${esc(lab || color)}" style="background:radial-gradient(circle at 35% 30%,${sh(color, 0.25)},${color} 55%,${sh(color, -0.18)})"></button>`;
    const pct = (v, min, max) => `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;
    function paintPanel() {
      const k = cat(), p = $("#hpaPanel");
      $$(".hpa-cat").forEach((b) => { const on = b.dataset.cat === k.id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
      p.setAttribute("aria-labelledby", "hpaTab-" + k.id);
      p.innerHTML = k.sec.map((s, si) => {
        if (s.t === "tiles") {
          const opts = OPT[s.key];
          return `<div class="hpa-sec"><h3>${esc(s.title)}</h3><div class="hpa-tiles${s.few ? " few" : ""}${s.tall ? " tall" : ""}" role="group" aria-label="${esc(s.title)}">${opts.map((v) => {
            const look = { ...st.c, [s.key]: v };
            if (s.key === "liner" && v !== "none") look.lashes = look.lashes === "none" ? "natural" : look.lashes;
            if (s.key === "top") look.outer = "none";
            if (s.key === "hair" || s.key === "face") look.hat = "none";
            return `<button type="button" class="hpa-tile" data-k="${s.key}" data-v="${v}" aria-pressed="${st.c[s.key] === v}">${render(look, 120, { crop: s.crop, slice: !s.tall, label: label(s.key, v) })}<span>${esc(label(s.key, v))}</span></button>`;
          }).join("")}</div></div>`;
        }
        if (s.t === "colors") {
          const cur = st.c[s.key], list = PAL[s.pal];
          const custom = okHex(cur) && !list.includes(cur);
          return `<div class="hpa-sec"><h3>${esc(s.title)}</h3><div class="hpa-sws${s.small ? " sm" : ""}" role="group" aria-label="${esc(s.title)}" data-k="${s.key}" data-si="${si}">${s.auto ? `<button type="button" class="hpa-chip" data-auto="1" aria-pressed="${!okHex(cur)}">${esc(s.auto)}</button>` : ""}${list.map((col) => swatch(col, cur === col)).join("")}${custom ? swatch(cur, true, "Custom color") : ""}<label class="hpa-sw custom" title="Pick any color">${I.plus}<input type="color" value="${okHex(cur) ? cur : "#888888"}" aria-label="Pick a custom ${esc(s.title.toLowerCase())}"></label></div></div>`;
        }
        if (s.t === "amount") {
          const v = +(st.c[s.key] || 0);
          return `<div class="hpa-sec"><div class="hpa-sl"><label for="hpaA-${s.key}">${esc(s.title)}</label><input class="hpa-range" id="hpaA-${s.key}" type="range" min="0" max="1" step="0.05" value="${v}" data-amt="${s.key}" style="--p:${pct(v, 0, 1)}"><output>${Math.round(v * 100)}%</output></div></div>`;
        }
        if (s.t === "sliders") {
          return `<div class="hpa-sec"><h3>${esc(s.title)}<button type="button" class="r" data-reset="${s.items.map((x) => x[0]).join(",")}">${I.reset}Reset</button></h3>${s.items.map(([tk, lab]) => { const v = get(tk); return `<div class="hpa-sl"><label for="hpaT-${tk}">${esc(lab)}</label><input class="hpa-range" id="hpaT-${tk}" type="range" min="-1" max="1" step="0.05" value="${v}" data-tune="${tk}" style="--p:${pct(v, -1, 1)}"><output>${v > 0 ? "+" : ""}${Math.round(v * 100)}</output></div>`; }).join("")}</div>`;
        }
        if (s.t === "chips") {
          return `<div class="hpa-sec"><h3>${esc(s.title)}</h3><div class="hpa-sws" role="group" aria-label="${esc(s.title)}">${OPT[s.key].map((v) => `<button type="button" class="hpa-chip" data-k="${s.key}" data-v="${v}" aria-pressed="${st.c[s.key] === v}"><i style="background:linear-gradient(135deg,${METAL[v][0]},${METAL[v][1]})"></i>${esc(label(s.key, v))}</button>`).join("")}</div></div>`;
        }
        if (s.t === "name") {
          return `<div class="hpa-sec"><label class="hpa-field"><span>Callsign (what the team sees)</span><input id="hpaHandle" maxlength="20" autocomplete="off" placeholder="e.g. Maverick" value="${esc(st.handle)}"></label><label class="hpa-field"><span>Motto (optional)</span><input id="hpaMotto" maxlength="60" autocomplete="off" placeholder="Every no gets me closer to a yes" value="${esc(st.motto)}"></label><div class="hpa-err" id="hpaErr" role="alert"></div><p class="hpa-note">Your character, callsign and motto are visible to everyone on the team.</p></div>`;
        }
        return "";
      }).join("");
      wirePanel();
    }
    function refreshAfterChange(pop = true) { paintAv(pop); paintPanel(); if (typeof bmBanner === "function") bmBanner(); }
    function wirePanel() {
      const p = $("#hpaPanel");
      p.querySelectorAll(".hpa-tile, .hpa-chip[data-k]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.k, v = b.dataset.v; if (st.c[k] === v) return;
        const also = [];
        if (k === "liner" && v !== "none" && st.c.lashes === "none") also.push(["lashes", "natural"]);
        setVal(k, v, { also, direct: true }); const y = p.scrollTop; refreshAfterChange(); p.scrollTop = y;
        p.querySelector(`[data-k="${k}"][data-v="${v}"]`)?.focus({ preventScroll: true });
      }));
      p.querySelectorAll(".hpa-sws[data-k]").forEach((g) => {
        const k = g.dataset.k, s = cat().sec[+g.dataset.si];
        const apply = (col) => {
          const also = [];
          if (s.bump && !(st.c[s.bump[0]] > 0)) also.push([s.bump[0], s.bump[1]]);
          if (s.set) also.push([s.set[0], s.set[1]]);
          setVal(k, col, { also }); const y = p.scrollTop; refreshAfterChange(); p.scrollTop = y;
        };
        g.querySelectorAll(".hpa-sw[data-col]").forEach((b) => b.addEventListener("click", () => { apply(b.dataset.col); p.querySelector(`.hpa-sws[data-k="${k}"] [data-col="${b.dataset.col}"]`)?.focus({ preventScroll: true }); }));
        g.querySelector("[data-auto]")?.addEventListener("click", () => apply(null));
        const inp = g.querySelector('input[type="color"]');
        if (inp) {
          let started = false;
          inp.addEventListener("input", () => { if (!started) { push(); started = true; } setVal(k, inp.value, { noHistory: true, also: s.set ? [[s.set[0], s.set[1]]] : [] }); paintAv(false); });
          inp.addEventListener("change", () => { started = false; const y = p.scrollTop; paintPanel(); p.scrollTop = y; });
        }
      });
      p.querySelectorAll(".hpa-range").forEach((r) => {
        let started = false;
        const k = r.dataset.tune || r.dataset.amt, isTune = !!r.dataset.tune;
        r.addEventListener("input", () => {
          if (!started) { push(); started = true; }
          const v = +r.value; setVal(k, v, { noHistory: true });
          r.style.setProperty("--p", pct(v, isTune ? -1 : 0, 1));
          r.nextElementSibling.textContent = isTune ? `${v > 0 ? "+" : ""}${Math.round(v * 100)}` : `${Math.round(v * 100)}%`;
          paintAv(false);
        });
        r.addEventListener("change", () => { started = false; });
        r.addEventListener("dblclick", () => { push(); setVal(k, 0, { noHistory: true }); const y = p.scrollTop; refreshAfterChange(false); p.scrollTop = y; });
      });
      p.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => {
        push(); const tune = { ...st.c.tune }; for (const k of b.dataset.reset.split(",")) delete tune[k]; st.c = { ...st.c, tune };
        const y = p.scrollTop; refreshAfterChange(); p.scrollTop = y;
      }));
      const h = $("#hpaHandle"), m = $("#hpaMotto");
      if (h) { h.addEventListener("input", () => { st.handle = h.value; st.dirty = true; $("#hpaErr").textContent = ""; }); setTimeout(() => h.focus(), 30); }
      if (m) m.addEventListener("input", () => { st.motto = m.value; st.dirty = true; });
    }
    const go = (id) => { st.cat = id; st.zoom = null; paintPanel(); paintAv(false); $("#hpaPanel").scrollTop = 0; };
    $$(".hpa-cat").forEach((b) => b.addEventListener("click", () => go(b.dataset.cat)));
    $(".hpa-cats").addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault(); const i = CATS.findIndex((k) => k.id === st.cat);
      const n = e.key === "Home" ? 0 : e.key === "End" ? CATS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + CATS.length) % CATS.length;
      go(CATS[n].id); root.querySelector(`[data-cat="${CATS[n].id}"]`).focus();
    });
    $$(".hpa-seg [data-v]").forEach((b) => b.addEventListener("click", () => { st.zoom = b.dataset.v; paintAv(true); }));
    const undo = () => { if (!st.undo.length) return; st.redo.push(snapshot()); st.c = JSON.parse(st.undo.pop()); refreshAfterChange(); };
    const redo = () => { if (!st.redo.length) return; st.undo.push(snapshot()); st.c = JSON.parse(st.redo.pop()); refreshAfterChange(); };
    $('[data-a="undo"]').onclick = undo; $('[data-a="redo"]').onclick = redo;
    $('[data-a="rand"]').onclick = () => { push(); const keepBg = st.c.bg; st.c = random(); if (o.char) st.c.bg = keepBg; refreshAfterChange(); };
    function close(force) {
      if (st.dirty && !force) {
        if (root.querySelector(".hpa-discard")) return;
        const bar = document.createElement("div"); bar.className = "hpa-discard"; bar.setAttribute("role", "alertdialog"); bar.setAttribute("aria-label", "Discard changes?");
        bar.innerHTML = `<span>Leave without saving?</span><button class="hpa-btn" data-k="1">Keep editing</button><button class="hpa-btn pri" data-d="1">Discard</button>`;
        root.querySelector(".hpa-stage").append(bar);
        bar.querySelector("[data-k]").onclick = () => bar.remove(); bar.querySelector("[data-d]").onclick = () => close(true); bar.querySelector("[data-k]").focus();
        return;
      }
      document.removeEventListener("keydown", onKey, true);
      root.classList.remove("in"); setTimeout(() => root.remove(), 220);
      try { prevFocus?.focus?.({ preventScroll: true }); } catch {}
      o.onClose?.();
    }
    $('[data-a="close"]').onclick = () => close();
    // ---- Bitmoji through Snap Login Kit ----
    const bmBanner = () => {
      root.querySelector(".hpa-bmbar")?.remove();
      if (!bitmojiUrl(st.c)) return;
      const bar = document.createElement("div"); bar.className = "hpa-bmbar";
      bar.innerHTML = `<span>Using your Bitmoji. Change your look in Snapchat, then refresh it here.</span><button class="hpa-btn" data-bm="refresh">Refresh</button><button class="hpa-btn" data-bm="off">Use drawn character</button>`;
      root.querySelector(".hpa-stage").append(bar);
      bar.querySelector('[data-bm="refresh"]').onclick = openBitmoji;
      bar.querySelector('[data-bm="off"]').onclick = () => { push(); const n = { ...st.c }; delete n.bitmoji; st.c = n; bmBanner(); refreshAfterChange(); };
    };
    let snapCfg = null, snapLoading = null;
    const loadSnap = () => snapLoading || (snapLoading = new Promise((res, rej) => {
      if (window.snap?.loginkit) return res();
      window.snapKitInit = () => res();
      const sc = document.createElement("script"); sc.src = "https://sdk.snapkit.com/js/v1/login.js"; sc.async = true;
      sc.onerror = () => { snapLoading = null; rej(new Error("Couldn't reach Snapchat. Check your connection and try again.")); };
      document.head.append(sc);
    }));
    async function openBitmoji() {
      root.querySelector(".hpa-bm")?.remove();
      const m = document.createElement("div"); m.className = "hpa-bm"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Use my Bitmoji");
      m.innerHTML = `<h3>Use your Bitmoji</h3><p>Sign in with Snapchat and allow your Bitmoji. It becomes your character everywhere on the desk. You change your look in Snapchat.</p><div id="hpaSnapBtn" class="hpa-snapbtn"></div><p class="hpa-bmmsg" role="status">Loading Snapchat sign-in…</p><button class="hpa-btn" data-x="1">Cancel</button>`;
      root.append(m); m.querySelector("[data-x]").onclick = () => m.remove();
      const msg = (t) => { const e = m.querySelector(".hpa-bmmsg"); if (e) e.textContent = t; };
      try {
        snapCfg = snapCfg || (await fetch("/api/config").then((r) => r.json()).catch(() => ({})));
        if (!snapCfg.snapClientId) { msg("Bitmoji isn't switched on yet. Your admin adds the Snap Client ID in the site settings."); return; }
        await loadSnap();
        let clicked = false;
        m.querySelector("#hpaSnapBtn").addEventListener("click", () => { clicked = true; msg("Finish signing in to Snapchat in the window that opened…"); }, true);
        window.snap.loginkit.mountButton("hpaSnapBtn", {
          clientId: snapCfg.snapClientId, redirectURI: location.origin + "/", scopeList: ["user.display_name", "user.bitmoji.avatar"],
          handleResponseCallback: () => {
            if (clicked) msg("Getting your Bitmoji…");
            window.snap.loginkit.fetchUserInfo().then((r) => {
              const url = r?.data?.me?.bitmoji?.avatar;
              if (!url || !/^https:\/\//.test(url)) { msg("Snapchat didn't share a Bitmoji. Make sure you have one in Snapchat and allow Bitmoji access."); return; }
              push(); st.c = { ...st.c, bitmoji: url }; m.remove(); bmBanner(); refreshAfterChange();
              if (!st.handle && r?.data?.me?.displayName) st.handle = String(r.data.me.displayName).slice(0, 20);
            }, () => msg(clicked ? "Couldn't get your Bitmoji from Snapchat. Try again." : ""));
          },
        });
        msg("");
      } catch (e) { msg(e.message || "Couldn't load Snapchat sign-in."); }
    }
    $('[data-a="bitmoji"]').onclick = openBitmoji;
    root.addEventListener("mousedown", (e) => { if (e.target === root) close(); });
    const save = async () => {
      const h = (st.handle || "").trim().replace(/\s+/g, " "), m = (st.motto || "").trim();
      const fail = (msg) => { if (st.cat !== "name") go("name"); setTimeout(() => { const er = $("#hpaErr"); if (er) er.textContent = msg; $("#hpaHandle")?.focus(); }, 40); };
      if (o.requireHandle !== false) {
        if (h.length < 2) return fail("Add a callsign (at least 2 characters) to finish.");
        if (!/^[\p{L}\p{N} ._'-]+$/u.test(h)) return fail("Callsigns can use letters, numbers, spaces and . _ ' -");
        if (o.isTaken?.(h)) return fail("Someone on the team already has that callsign.");
      }
      const b = $('[data-a="save"]'); b.disabled = true; b.textContent = "Saving…";
      try { await o.onSave?.({ char: st.c, handle: h, motto: m }); st.dirty = false; close(true); }
      catch (e) { b.disabled = false; b.textContent = "Save"; fail("Couldn't save: " + (e?.message || e)); }
    };
    $('[data-a="save"]').onclick = save;
    function onKey(e) {
      if (!document.body.contains(root)) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); const bar = root.querySelector(".hpa-discard"); if (bar) bar.remove(); else close(); return; }
      const inField = e.target.closest?.("input:not([type=range]):not([type=color])");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key === "Tab") {
        const f = [...root.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')].filter((x) => x.offsetParent !== null);
        if (!f.length) return; const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    paintPanel(); paintAv(false); bmBanner();
    requestAnimationFrame(() => { root.classList.add("in"); root.querySelector(`[data-cat="${st.cat}"]`)?.focus({ preventScroll: true }); });
    return { close };
  }

  window.hpAvatar = { render, migrate, random, DEF, OPT, PAL, LABEL, label, TUNE, CROPS, mix, sh, okHex, openCreator };
})();
