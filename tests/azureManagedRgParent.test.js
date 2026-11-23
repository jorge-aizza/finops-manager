const test = require('node:test');
const assert = require('node:assert/strict');
const { addSyntheticParentOptions, extractManagedRgParentLink } = require('../azureManagedRgParent');

test('resolves AKS node resource group to its cluster parent RG', () => {
  assert.deepEqual(extractManagedRgParentLink({
    type: 'Microsoft.ContainerService/managedClusters',
    resourceGroup: 'app-parent-rg',
    nodeResourceGroup: 'MC_app-parent-rg_cluster_eastus',
  }, 'sub-1'), {
    subscription_id: 'sub-1',
    managed_rg: 'MC_app-parent-rg_cluster_eastus',
    parent_rg: 'app-parent-rg',
    managed_type: 'aks',
  });
});

test('extracts Databricks managed RG from managedResourceGroupId', () => {
  assert.deepEqual(extractManagedRgParentLink({
    type: 'Microsoft.Databricks/workspaces',
    resourceGroup: 'workspace-parent-rg',
    managedResourceGroupId: '/subscriptions/sub-2/resourceGroups/managed-rg-adbx-ws-123',
  }, 'sub-2'), {
    subscription_id: 'sub-2',
    managed_rg: 'managed-rg-adbx-ws-123',
    parent_rg: 'workspace-parent-rg',
    managed_type: 'databricks',
  });
});

test('ignores resources without an authoritative managed RG relationship', () => {
  assert.equal(extractManagedRgParentLink({
    type: 'Microsoft.Compute/virtualMachines',
    resourceGroup: 'ordinary-rg',
  }, 'sub-3'), null);
  assert.equal(extractManagedRgParentLink({
    type: 'Microsoft.Databricks/workspaces',
    resourceGroup: 'workspace-parent-rg',
    managedResourceGroupId: null,
  }, 'sub-3'), null);
});

test('adds an unbilled parent option and respects the public portal allowlist', () => {
  const managed = {
    subscription_id: 'sub-4', resource_group_name: 'MC_parent_cluster_region',
    parent_rg: 'parent-rg', moeda: 'BRL', managed_type: 'aks',
  };
  const withParent = addSyntheticParentOptions([managed]);
  assert.equal(withParent.length, 2);
  assert.equal(withParent[1].resource_group_name, 'parent-rg');
  assert.equal(withParent[1].parent_rg, null);

  const restricted = addSyntheticParentOptions([managed], ['other-rg']);
  assert.equal(restricted.length, 1);
  assert.equal(restricted[0].parent_rg, null);
  assert.equal(addSyntheticParentOptions([managed], ['PARENT-RG']).length, 2);
});