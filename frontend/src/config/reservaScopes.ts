// Porta fiel de _RSV_TIPOS / _RSV_SCOPE_CONFIG / _RSV_DEFAULT_SCOPE (app.js) —
// as chaves são os valores exatos salvos no banco (cloud, tipo_escopo), não mude.

export const CLOUDS = ['Azure', 'AWS', 'GCP', 'Oracle', 'Multicloud'] as const
export type Cloud = (typeof CLOUDS)[number]

export const TIPOS_RECURSO: Record<Cloud, string[]> = {
  Azure: [
    'Reserved VM Instances', 'Azure Savings Plan (Compute)', 'Azure Savings Plan (VMs)',
    'SQL Database', 'Cosmos DB', 'App Service Plan', 'Azure Databricks',
    'Redis Cache', 'PostgreSQL Flexible', 'MySQL Flexible',
  ],
  AWS: [
    'EC2 Reserved Instances', 'Savings Plan - Compute', 'Savings Plan - EC2 Instance',
    'Savings Plan - SageMaker', 'RDS Reserved Instances', 'ElastiCache Reserved',
    'OpenSearch Reserved', 'Redshift Reserved', 'DynamoDB Reserved Capacity',
  ],
  GCP: [
    'Committed Use - General Purpose VM', 'Committed Use - Memory Optimized VM',
    'Committed Use - GPU', 'Cloud SQL Committed Use', 'BigQuery Slot Commitments',
  ],
  Oracle: [
    'Compute Universal Credits', 'Database Cloud Service', 'Autonomous Database',
    'Analytics Cloud', 'Oracle Integration',
  ],
  Multicloud: ['Capacidade Reservada Geral'],
}

export interface ScopeFieldConfig {
  label: string
  placeholder: string
  api?: boolean // true = dropdown de busca (só Azure); ausente = input manual
}

export interface ScopeConfig {
  sub?: ScopeFieldConfig
  rg?: ScopeFieldConfig
}

export const SCOPE_CONFIG: Record<Cloud, Record<string, ScopeConfig>> = {
  Azure: {
    Shared: {},
    Tenant: { sub: { label: 'Tenant (Azure AD)', placeholder: 'ID ou nome do Tenant' } },
    'Management Group': { sub: { label: 'Management Group', placeholder: 'Nome do Management Group' } },
    Subscription: { sub: { label: 'Subscription', placeholder: 'Selecione a Subscription', api: true } },
    'Resource Group': {
      sub: { label: 'Subscription', placeholder: 'Selecione a Subscription', api: true },
      rg: { label: 'Resource Group', placeholder: 'Selecione o Resource Group', api: true },
    },
  },
  AWS: {
    Shared: {},
    Organization: { sub: { label: 'Organization ID', placeholder: 'Ex: o-xxxxxxxxxx' } },
    Account: { sub: { label: 'Account ID', placeholder: 'Ex: 123456789012' } },
    OU: {
      sub: { label: 'Account ID', placeholder: 'Ex: 123456789012' },
      rg: { label: 'Organizational Unit (OU)', placeholder: 'Ex: ou-xxxx-xxxxxxxx' },
    },
  },
  GCP: {
    Shared: {},
    Organization: { sub: { label: 'Organization ID', placeholder: 'Ex: 1234567890' } },
    Project: { sub: { label: 'Project ID', placeholder: 'Ex: my-project-id' } },
    Folder: {
      sub: { label: 'Project ID', placeholder: 'Ex: my-project-id' },
      rg: { label: 'Folder', placeholder: 'ID ou nome da Pasta' },
    },
  },
  Oracle: {
    Shared: {},
    Tenancy: { sub: { label: 'Tenancy', placeholder: 'OCID do Tenancy' } },
    Compartment: {
      sub: { label: 'Tenancy', placeholder: 'OCID do Tenancy' },
      rg: { label: 'Compartment', placeholder: 'OCID ou nome do Compartment' },
    },
  },
  Multicloud: { Shared: {} },
}

export const DEFAULT_SCOPE: Record<Cloud, string> = {
  Azure: 'Subscription', AWS: 'Account', GCP: 'Project', Oracle: 'Tenancy', Multicloud: 'Shared',
}

export const CLOUD_COLORS: Record<string, string> = {
  Azure: '#4da6ff', AWS: '#ff8c42', GCP: '#22c55e', Oracle: '#ff4d6a', Multicloud: '#9333ea',
}

export const STATUS_COLORS: Record<string, string> = {
  Ativa: '#22c55e', Expirada: '#ff4d6a', Cancelada: '#7b6a9e',
}
