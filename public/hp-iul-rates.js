/* Published IUL crediting terms for carriers Highpoint already quotes.
   Caps and participation change. Confirm in the carrier illustration before you pitch. */
window.HP_IUL_RATES = {
  asOf: "Oct 2026",
  note: "Market-checked from the latest public product guides we could verify. Caps, participation, bonuses and spreads can change. Not a guarantee. Run the carrier illustration before you present a number.",
  rows: [
    {
      k: "ta", n: "Transamerica", product: "Financial Foundation IUL II",
      par: "100% (S&P / Global); 113% balanced uncapped",
      cap: "S&P 12.25% · Global 13.25% · Basic S&P 9.00% · Balanced uncapped",
      floor: "0.75% index / 2% basic interest account",
      indexes: "S&P 500, Global, Balanced Uncapped",
      extra: "0.72%/yr index account charge on most accounts (not Basic S&P). Max illustrated 7.25% on the capped/uncapped accounts.",
      asOf: "Jul 2025 / reprinted 2026",
      src: "Transamerica FFIUL II consumer guide & FMI advisor materials (3822702R3, 3832306R3)",
      checked: true
    },
    {
      k: "fg", n: "F&G", product: "Pathsetter",
      par: "100% or 140% on S&P annual PTP",
      cap: "S&P 12% @ 100% · 9.5% @ 140% · 9% @ 100% + 1% AV bonus · monthly PTP 3.5%",
      floor: "0.25% min annual index credit",
      indexes: "S&P 500 (annual + monthly PTP), Barclays Trailblazer 5, Morgan Stanley US Equity Allocator, BlackRock Market Advantage",
      extra: "Barclays 170% par + 1% AV bonus; BlackRock 160% par + 1% AV bonus; persistency bonus 0.25% years 11+. Variable loan max 5%.",
      asOf: "Apr 2026",
      src: "F&G ADV5572 Rev. 04-2026; ADV2260 Pathsetter at-a-glance",
      checked: true
    },
    {
      k: "moo", n: "Mutual of Omaha", product: "IUL Express",
      par: "100% or 140% on S&P; uncapped option also offered",
      cap: "9.25% @ 100% · 6.50% @ 140% (renewal segments through Sep 2026)",
      floor: "0% on index strategies",
      indexes: "S&P 500 (100%, high-par, uncapped), BofA U.S. Agility uncapped",
      extra: "Caps/par can change monthly. Confirm the uncapped participation on today’s illustration.",
      asOf: "Sep 2026 renewals",
      src: "Mutual of Omaha IULE historical rate flyer 468056_1125; IULE product guide 457978_0725",
      checked: true
    },
    {
      k: "aig", n: "AIG / Corebridge", product: "Max Accumulator+ III (accum) · Value+ Protector (protection)",
      par: "100% S&P / Nasdaq; PIMCO 80%; ML Balanced 100% uncapped",
      cap: "S&P High Cap 11.25% · High Bonus 9.50% · Nasdaq 11.50% (Jun 27, 2026 flyer). Confirm on today’s illustration.",
      floor: "0% on index credit (charges still come out)",
      indexes: "S&P 500 High Cap, S&P 500 High Bonus, Nasdaq-100 (not CA/NY), ML Strategic Balanced, PIMCO Global Optima",
      extra: "Account-value enhancement years 6+: High Cap 0.25%, High Bonus 0.60%, Nasdaq 0.10%. Consumer brochure does not print caps.",
      asOf: "Jun 27, 2026",
      src: "Corebridge QoL IUL interest-rate flyer effective Jun 27, 2026 (FP use); Max Accumulator+ III announcement Jun 2026",
      checked: false
    },
    {
      k: "eth", n: "Ethos", product: "Ethos IUL (Ameritas) / Accumulation IUL (North American)",
      par: "Confirm in illustration",
      cap: "Not published on the consumer brochure",
      floor: "0% on index options",
      indexes: "S&P 500 (1-year and 2-year), plus partner indexes (Ethos brochure: Sector Rotator, BNP Paribas Momentum; North American: nine options)",
      extra: "Digital / instant-leaning. Caps move with the issuing carrier. Do not pitch a cap until the illustration shows it.",
      asOf: "2026 partner materials",
      src: "Ethos IUL client brochure; Ethos / North American Accumulation IUL release (Jan 7, 2026)",
      checked: false
    }
  ]
};
