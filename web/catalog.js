export const catalog = {
  reviewedAt: '2026-10-30',
  priceReviewBefore: '2026-11-01T00:00:00+08:00',
  pricingUrl: 'https://cloud.google.com/products/dws/pricing#flex-start-tpu-vm-pricing',
  guideUrl: 'https://docs.google.com/document/d/1u2W79sxupb1Nm53zONbsnjyHzwcjuu-76urThl-MhRs/edit',
  machines: [
    {family:'TPU v6e',machine:'ct6e-standard-4t',chips:4,zones:['us-central1-a'],hourlyCents:540,status:'設定中',detail:'第一版規劃：Flex-start，每次最長 4 小時。'},
    {family:'TPU v5p',machine:'ct5p-hightpu-4t',chips:4,zones:['us-central1-a','us-east5-a'],hourlyCents:840,status:'未開放',detail:'計畫支援；容量有限，尚未完成本系統設定。'},
    {family:'TPU v5e',machine:'v5litepod-4 · Cloud TPU API',chips:4,zones:['us-west4-a','europe-west4-b'],hourlyCents:240,status:'未開放',detail:'使用舊版 Queued Resources API，尚未完成本系統設定。'}
  ]
};
