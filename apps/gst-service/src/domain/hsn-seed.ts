// HSN seed data — top textile/retail chapters for Indian cloth retail
// Source: CBIC HSN Master (selected textile + retail chapters)

export interface HsnSeedRow {
  hsnCode: string;
  description: string;
  gstRate: string;
  cessRate: string;
  chapter: string;
  heading: string;
}

export const HSN_SEED_DATA: HsnSeedRow[] = [
  // Chapter 50 — Silk
  { hsnCode: '5007', description: 'Woven fabrics of silk or silk waste', gstRate: '5', cessRate: '0', chapter: '50', heading: '5007' },
  { hsnCode: '500710', description: 'Fabrics of noil silk', gstRate: '5', cessRate: '0', chapter: '50', heading: '5007' },
  { hsnCode: '500720', description: 'Other woven fabrics, 85%+ silk or silk waste', gstRate: '5', cessRate: '0', chapter: '50', heading: '5007' },
  { hsnCode: '500790', description: 'Other woven fabrics of silk', gstRate: '5', cessRate: '0', chapter: '50', heading: '5007' },

  // Chapter 52 — Cotton
  { hsnCode: '5208', description: 'Woven fabrics of cotton, 85%+, weight ≤ 200 g/m²', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '520811', description: 'Plain weave cotton, 85%+, wt ≤ 100g/m² (unbleached)', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '520812', description: 'Plain weave cotton, 85%+, wt 100-200g/m² (unbleached)', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '520821', description: 'Plain weave cotton, 85%+, wt ≤ 100g/m² (bleached)', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '520831', description: 'Plain weave cotton dyed, 85%+, wt ≤ 100g/m²', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '520851', description: 'Plain weave cotton printed, 85%+, wt ≤ 100g/m²', gstRate: '5', cessRate: '0', chapter: '52', heading: '5208' },
  { hsnCode: '5209', description: 'Woven fabrics of cotton, 85%+, weight > 200 g/m²', gstRate: '5', cessRate: '0', chapter: '52', heading: '5209' },
  { hsnCode: '5210', description: 'Woven fabrics of cotton, < 85%, mixed mainly with MMF', gstRate: '5', cessRate: '0', chapter: '52', heading: '5210' },
  { hsnCode: '5211', description: 'Woven fabrics of cotton, < 85%, mixed mainly with MMF, wt > 200g', gstRate: '5', cessRate: '0', chapter: '52', heading: '5211' },
  { hsnCode: '5212', description: 'Other woven fabrics of cotton', gstRate: '5', cessRate: '0', chapter: '52', heading: '5212' },

  // Chapter 54 — Man-made filaments
  { hsnCode: '5407', description: 'Woven fabrics of synthetic filament yarn', gstRate: '5', cessRate: '0', chapter: '54', heading: '5407' },
  { hsnCode: '540710', description: 'Woven fabrics of high tenacity yarn of nylon/polyamide', gstRate: '5', cessRate: '0', chapter: '54', heading: '5407' },
  { hsnCode: '540720', description: 'Woven fabrics obtained from strip/the like of synthetic fibre', gstRate: '5', cessRate: '0', chapter: '54', heading: '5407' },
  { hsnCode: '540761', description: 'Woven fabrics, unbleached or bleached, 85%+ polyester filaments', gstRate: '5', cessRate: '0', chapter: '54', heading: '5407' },
  { hsnCode: '540771', description: 'Woven fabrics, unbleached or bleached, 85%+ polyester staple', gstRate: '5', cessRate: '0', chapter: '54', heading: '5407' },
  { hsnCode: '5408', description: 'Woven fabrics of artificial filament yarn', gstRate: '5', cessRate: '0', chapter: '54', heading: '5408' },

  // Chapter 55 — Man-made staple fibres
  { hsnCode: '5512', description: 'Woven fabrics of synthetic staple fibres, 85%+', gstRate: '5', cessRate: '0', chapter: '55', heading: '5512' },
  { hsnCode: '5513', description: 'Woven fabrics of synthetic staple fibres, < 85%, mixed mainly with cotton', gstRate: '5', cessRate: '0', chapter: '55', heading: '5513' },
  { hsnCode: '5514', description: 'Woven fabrics of synthetic staple fibres, < 85%, weight > 170g/m²', gstRate: '5', cessRate: '0', chapter: '55', heading: '5514' },
  { hsnCode: '5515', description: 'Other woven fabrics of synthetic staple fibres', gstRate: '5', cessRate: '0', chapter: '55', heading: '5515' },
  { hsnCode: '5516', description: 'Woven fabrics of artificial staple fibres', gstRate: '5', cessRate: '0', chapter: '55', heading: '5516' },

  // Chapter 58 — Special woven fabrics
  { hsnCode: '5801', description: 'Woven pile fabrics and chenille fabrics (excl. terry towelling)', gstRate: '5', cessRate: '0', chapter: '58', heading: '5801' },
  { hsnCode: '5804', description: 'Tulles, lace, net, embroidery', gstRate: '12', cessRate: '0', chapter: '58', heading: '5804' },
  { hsnCode: '5806', description: 'Narrow woven fabrics, ribbons', gstRate: '12', cessRate: '0', chapter: '58', heading: '5806' },
  { hsnCode: '5810', description: 'Embroidery in piece, in strips or in motifs', gstRate: '12', cessRate: '0', chapter: '58', heading: '5810' },

  // Chapter 61 — Knitted or crocheted garments
  { hsnCode: '6101', description: "Men's/boys' overcoats, car-coats etc., knitted", gstRate: '5', cessRate: '0', chapter: '61', heading: '6101' },
  { hsnCode: '6104', description: "Women's suits, ensembles, jackets etc., knitted", gstRate: '5', cessRate: '0', chapter: '61', heading: '6104' },
  { hsnCode: '6105', description: "Men's/boys' shirts, knitted", gstRate: '5', cessRate: '0', chapter: '61', heading: '6105' },
  { hsnCode: '6109', description: 'T-shirts, singlets and other vests, knitted', gstRate: '5', cessRate: '0', chapter: '61', heading: '6109' },
  { hsnCode: '6110', description: 'Jerseys, pullovers, sweatshirts, waistcoats, similar articles, knitted', gstRate: '5', cessRate: '0', chapter: '61', heading: '6110' },
  { hsnCode: '6115', description: 'Pantyhose, tights, stockings, socks and other hosiery', gstRate: '5', cessRate: '0', chapter: '61', heading: '6115' },

  // Chapter 62 — Woven garments
  { hsnCode: '6201', description: "Men's/boys' overcoats, car-coats, cloaks, anoraks etc.", gstRate: '12', cessRate: '0', chapter: '62', heading: '6201' },
  { hsnCode: '6203', description: "Men's/boys' suits, ensembles, jackets, blazers, trousers", gstRate: '12', cessRate: '0', chapter: '62', heading: '6203' },
  { hsnCode: '6204', description: "Women's/girls' suits, ensembles, jackets, dresses, skirts", gstRate: '12', cessRate: '0', chapter: '62', heading: '6204' },
  { hsnCode: '6205', description: "Men's/boys' shirts", gstRate: '12', cessRate: '0', chapter: '62', heading: '6205' },
  { hsnCode: '6206', description: "Women's/girls' blouses, shirts", gstRate: '12', cessRate: '0', chapter: '62', heading: '6206' },
  { hsnCode: '6210', description: 'Garments made up of fabrics of heading 5602, 5603, 5903 etc.', gstRate: '12', cessRate: '0', chapter: '62', heading: '6210' },
  { hsnCode: '6211', description: 'Track suits, ski suits and swimwear', gstRate: '12', cessRate: '0', chapter: '62', heading: '6211' },
  { hsnCode: '6217', description: 'Other made up clothing accessories; parts of garments', gstRate: '12', cessRate: '0', chapter: '62', heading: '6217' },

  // Retail / accessories
  { hsnCode: '6301', description: 'Blankets and travelling rugs', gstRate: '12', cessRate: '0', chapter: '63', heading: '6301' },
  { hsnCode: '6302', description: 'Bed linen, table linen, toilet linen and kitchen linen', gstRate: '5', cessRate: '0', chapter: '63', heading: '6302' },
  { hsnCode: '6303', description: 'Curtains, drapes and interior blinds; curtain or bed valances', gstRate: '5', cessRate: '0', chapter: '63', heading: '6303' },
  { hsnCode: '6305', description: 'Sacks and bags for packing of goods', gstRate: '12', cessRate: '0', chapter: '63', heading: '6305' },

  // Common retail items
  { hsnCode: '9404', description: 'Mattresses, quilts, pillows, sleeping bags', gstRate: '18', cessRate: '0', chapter: '94', heading: '9404' },

  // Tailoring / alteration charges (service)
  { hsnCode: '998815', description: 'Tailoring services — SAC code for tailoring/garment stitching', gstRate: '5', cessRate: '0', chapter: '99', heading: '9988' },
];
