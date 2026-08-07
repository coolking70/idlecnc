export function analyzeUniversalContact(plan) {
  const contact = plan.intent.contact || {}; const anchors = plan.timeline.anchors || [];
  return { ...contact, firstContactAnchorId: anchors.find((anchor) => ['fire', 'damage', 'ambush'].includes(anchor.type))?.id || null, firstRevealAnchorId: anchors.find((anchor) => anchor.type === 'reveal')?.id || null, firstDestroyAnchorId: anchors.find((anchor) => anchor.type === 'destroy')?.id || null };
}

