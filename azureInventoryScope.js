function resolveInventorySubscriptionOwners(spConfigs, accessibleBySp) {
  const candidatesBySubscription = new Map();
  for (const sp of spConfigs) {
    const subscriptionIds = [...new Set(String(sp.subscription_ids || '').split(/[\n,]+/).map((id) => id.trim()).filter(Boolean))];
    for (const subscriptionId of subscriptionIds) {
      const key = subscriptionId.toLowerCase();
      if (!candidatesBySubscription.has(key)) candidatesBySubscription.set(key, { subscriptionId, candidates: [] });
      candidatesBySubscription.get(key).candidates.push(sp);
    }
  }

  const scopes = [];
  const unowned = [];
  for (const { subscriptionId, candidates } of candidatesBySubscription.values()) {
    const accessible = candidates.filter((sp) => {
      const ids = accessibleBySp.get(sp.id);
      return ids instanceof Set && ids.has(subscriptionId.toLowerCase());
    });
    const unknown = candidates.filter((sp) => !accessibleBySp.has(sp.id) || accessibleBySp.get(sp.id) === null);
    const eligible = accessible.length ? accessible : unknown;
    if (!eligible.length) {
      unowned.push(subscriptionId);
      continue;
    }
    eligible.sort((a, b) => Number(!!b.is_padrao) - Number(!!a.is_padrao) || Number(a.id) - Number(b.id));
    scopes.push({ subscriptionId, sp: eligible[0], accessVerified: accessible.length > 0 });
  }
  return { scopes, unowned };
}

module.exports = { resolveInventorySubscriptionOwners };