const test = require('node:test')
const assert = require('node:assert/strict')
const { updateGenieBudgetPrincipalOverride } = require('../genieBudgetOverride')

test('updates only the selected principal across per-user levels and preserves shared levels', () => {
  const sharedAlert = {
    quantity_threshold: '1000',
    scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
    action_configurations: [{ action_type: 'BLOCK_USAGE' }],
  }
  const perUserAlerts = [
    {
      quantity_threshold: '50',
      scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
      action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }],
      principal_overrides: [
        { principal_id: 7, override_threshold: '60.00' },
        { principal_id: 8, override_threshold: '80.00' },
      ],
    },
    {
      quantity_threshold: '100',
      scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
      action_configurations: [{ action_type: 'BLOCK_USAGE', target: '' }],
      principal_overrides: [{ principal_id: 7, override_threshold: '120.00' }],
    },
  ]
  const budget = {
    budget_configuration_id: 'budget-1',
    filter: { tags: [{ key: 'team', value: { values: ['finops'] } }] },
    alert_configurations: [sharedAlert, ...perUserAlerts],
  }

  const updated = updateGenieBudgetPrincipalOverride(budget, 7, 200)

  assert.deepEqual(updated.alert_configurations[0], sharedAlert)
  assert.deepEqual(updated.filter, budget.filter)
  assert.deepEqual(updated.alert_configurations[1].principal_overrides, [
    { principal_id: 7, override_threshold: '100.00' },
    { principal_id: 8, override_threshold: '80.00' },
  ])
  assert.deepEqual(updated.alert_configurations[2].principal_overrides, [
    { principal_id: 7, override_threshold: '200.00' },
  ])
  assert.deepEqual(updated.alert_configurations[2].action_configurations, [{ action_type: 'BLOCK_USAGE' }])
})

test('adds a user override without changing unrelated principals', () => {
  const budget = {
    alert_configurations: [{
      quantity_threshold: '100',
      scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
      principal_overrides: [{ principal_id: 8, override_threshold: '120.00' }],
    }],
  }

  const updated = updateGenieBudgetPrincipalOverride(budget, 7, 175)

  assert.deepEqual(updated.alert_configurations[0].principal_overrides, [
    { principal_id: 8, override_threshold: '120.00' },
    { principal_id: 7, override_threshold: '175.00' },
  ])
})