const SERVICE_COLUMNS = Object.freeze({
  billingApi: 'coletar_billing_api',
  inventory: 'coletar_inventario',
  storage: 'coletar_storage',
  reservationsApi: 'coletar_reservas_api',
});

function azureSpServiceEnabled(sp, service) {
  const column = SERVICE_COLUMNS[service];
  if (!column) throw new Error(`Serviço de SP desconhecido: ${service}`);
  return sp?.[column] !== false;
}

module.exports = { SERVICE_COLUMNS, azureSpServiceEnabled };