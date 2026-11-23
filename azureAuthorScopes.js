function groupAuthorIdsBySp(authorRows, ownerBySubscription, preferredSpId = null) {
  const grouped = new Map();
  const unassigned = new Set();
  for (const row of authorRows) {
    const subscriptionId = String(row.subscription_id || '').toLowerCase();
    const spId = preferredSpId || ownerBySubscription.get(subscriptionId);
    const authorId = String(row.autor || '').trim();
    if (!spId || !authorId) {
      if (authorId) unassigned.add(authorId);
      continue;
    }
    if (!grouped.has(spId)) grouped.set(spId, new Set());
    grouped.get(spId).add(authorId);
  }
  return { grouped, unassigned };
}

function prioritizeGraphSpCandidates(candidates, preferredSpId = null) {
  return [...candidates].sort((a, b) => {
    const preferredA = preferredSpId != null && String(a.id) === String(preferredSpId);
    const preferredB = preferredSpId != null && String(b.id) === String(preferredSpId);
    return Number(preferredB) - Number(preferredA)
      || Number(!!b.is_padrao) - Number(!!a.is_padrao)
      || Number(a.id) - Number(b.id);
  });
}

module.exports = { groupAuthorIdsBySp, prioritizeGraphSpCandidates };