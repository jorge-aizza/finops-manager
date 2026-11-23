function updateGenieBudgetPrincipalOverride(budget, principalId, monthlyLimit) {
  const alertConfigurations = budget.alert_configurations || []
  const perUserAlerts = alertConfigurations.filter(
    (alert) => alert.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
  )
  if (!perUserAlerts.length) throw new Error('Esta quota não tem níveis por usuário.')

  const baseThreshold = Math.max(...perUserAlerts.map((alert) => Number(alert.quantity_threshold) || 0))
  if (baseThreshold <= 0) throw new Error('Não foi possível determinar o limite padrão por usuário.')

  const normalizedId = String(principalId)
  const updatedAlerts = alertConfigurations.map((alert) => {
    const actionConfigurations = (alert.action_configurations || []).map((action) => {
      if (action.action_type !== 'BLOCK_USAGE' || !Object.hasOwn(action, 'target')) return action
      const { target, ...blockAction } = action
      return blockAction
    })
    if (alert.scope_type !== 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER') {
      return { ...alert, action_configurations: actionConfigurations }
    }

    const levelThreshold = Number(alert.quantity_threshold)
    const overrideThreshold = (Math.round(monthlyLimit * levelThreshold / baseThreshold * 100) / 100).toFixed(2)
    if (Number(overrideThreshold) <= 0) {
      throw new Error('O limite é pequeno demais para gerar overrides válidos em todos os níveis por usuário.')
    }

    const existing = alert.principal_overrides || []
    const hasPrincipal = existing.some((override) => String(override.principal_id) === normalizedId)
    return {
      ...alert,
      action_configurations: actionConfigurations,
      principal_overrides: hasPrincipal
        ? existing.map((override) => String(override.principal_id) === normalizedId
          ? { ...override, override_threshold: overrideThreshold }
          : override)
        : [...existing, { principal_id: Number(principalId), override_threshold: overrideThreshold }],
    }
  })

  return { ...budget, alert_configurations: updatedAlerts }
}

module.exports = { updateGenieBudgetPrincipalOverride }