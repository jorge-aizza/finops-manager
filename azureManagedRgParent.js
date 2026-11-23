function _resourceGroupFromId(resourceId) {
  const match = String(resourceId || '').match(/(?:^|\/)resourceGroups\/([^/]+)/i);
  return match ? match[1] : null;
}

function extractManagedRgParentLink(item, subscriptionId) {
  const type = String(item?.type || '').toLowerCase();
  const parentRg = String(item?.resourceGroup || '').trim();
  if (!parentRg) return null;

  if (type === 'microsoft.containerservice/managedclusters') {
    const managedRg = String(item.nodeResourceGroup || item.properties?.nodeResourceGroup || '').trim();
    if (!managedRg) return null;
    return { subscription_id: subscriptionId, managed_rg: managedRg, parent_rg: parentRg, managed_type: 'aks' };
  }

  if (type === 'microsoft.databricks/workspaces') {
    const managedRgId = item.managedResourceGroupId || item.properties?.managedResourceGroupId;
    const managedRg = _resourceGroupFromId(managedRgId);
    if (!managedRg) return null;
    return { subscription_id: subscriptionId, managed_rg: managedRg, parent_rg: parentRg, managed_type: 'databricks' };
  }

  return null;
}

function addSyntheticParentOptions(rows, allowedParentRgs = null) {
  const allowed = allowedParentRgs ? new Set(allowedParentRgs.map((rg) => String(rg).toUpperCase())) : null;
  const visibleRows = allowed
    ? rows.map((row) => row.parent_rg && !allowed.has(String(row.parent_rg).toUpperCase()) ? { ...row, parent_rg: null } : row)
    : rows;
  const known = new Set(visibleRows.map((row) => `${row.subscription_id || ''}::${String(row.resource_group_name || '').toUpperCase()}`));
  const parents = [];
  for (const row of visibleRows) {
    if (!row.parent_rg || !row.subscription_id) continue;
    const parentUpper = String(row.parent_rg).toUpperCase();
    if (allowed && !allowed.has(parentUpper)) continue;
    const key = `${row.subscription_id}::${parentUpper}`;
    if (known.has(key)) continue;
    known.add(key);
    parents.push({
      subscription_id: row.subscription_id,
      resource_group_name: row.parent_rg,
      moeda: row.moeda || null,
      managed_type: null,
      managed_label: null,
      parent_rg: null,
    });
  }
  return [...visibleRows, ...parents];
}

module.exports = { addSyntheticParentOptions, extractManagedRgParentLink };