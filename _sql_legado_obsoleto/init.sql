-- ============================================================
-- SISTEMA FINOPS - Script de Inicialização do Banco de Dados
-- ============================================================

CREATE DATABASE finops;
\c finops;

-- Tabela de Projetos
CREATE TABLE IF NOT EXISTS projetos (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(200) NOT NULL UNIQUE,
  descricao     TEXT,
  criado_em     TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela de Ações FinOps
CREATE TABLE IF NOT EXISTS acoes_finops (
  id                  SERIAL PRIMARY KEY,
  id_finops           VARCHAR(50) UNIQUE NOT NULL,
  projeto_id          INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
  acao                VARCHAR(300) NOT NULL,
  cloud               VARCHAR(100),
  responsavel         VARCHAR(200),
  tipo_acao           VARCHAR(100),
  impacto_atual_mes   NUMERIC(15,2) DEFAULT 0,
  status              VARCHAR(50) DEFAULT 'Pendente',
  data_inicio         DATE,
  data_conclusao      DATE,
  retorno_ano_atual   NUMERIC(15,2) DEFAULT 0,
  retorno_proximo_ano NUMERIC(15,2) DEFAULT 0,

  -- Retornos Ano Atual (mês a mês)
  atual_janeiro       NUMERIC(15,2) DEFAULT 0,
  atual_fevereiro     NUMERIC(15,2) DEFAULT 0,
  atual_marco         NUMERIC(15,2) DEFAULT 0,
  atual_abril         NUMERIC(15,2) DEFAULT 0,
  atual_maio          NUMERIC(15,2) DEFAULT 0,
  atual_junho         NUMERIC(15,2) DEFAULT 0,
  atual_julho         NUMERIC(15,2) DEFAULT 0,
  atual_agosto        NUMERIC(15,2) DEFAULT 0,
  atual_setembro      NUMERIC(15,2) DEFAULT 0,
  atual_outubro       NUMERIC(15,2) DEFAULT 0,
  atual_novembro      NUMERIC(15,2) DEFAULT 0,
  atual_dezembro      NUMERIC(15,2) DEFAULT 0,

  -- Retornos Próximo Ano (mês a mês)
  proximo_janeiro     NUMERIC(15,2) DEFAULT 0,
  proximo_fevereiro   NUMERIC(15,2) DEFAULT 0,
  proximo_marco       NUMERIC(15,2) DEFAULT 0,
  proximo_abril       NUMERIC(15,2) DEFAULT 0,
  proximo_maio        NUMERIC(15,2) DEFAULT 0,
  proximo_junho       NUMERIC(15,2) DEFAULT 0,
  proximo_julho       NUMERIC(15,2) DEFAULT 0,
  proximo_agosto      NUMERIC(15,2) DEFAULT 0,
  proximo_setembro    NUMERIC(15,2) DEFAULT 0,
  proximo_outubro     NUMERIC(15,2) DEFAULT 0,
  proximo_novembro    NUMERIC(15,2) DEFAULT 0,
  proximo_dezembro    NUMERIC(15,2) DEFAULT 0,

  criado_em           TIMESTAMP DEFAULT NOW(),
  atualizado_em       TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_acoes_projeto ON acoes_finops(projeto_id);
CREATE INDEX IF NOT EXISTS idx_acoes_status ON acoes_finops(status);
CREATE INDEX IF NOT EXISTS idx_acoes_cloud ON acoes_finops(cloud);

-- Dados de exemplo
INSERT INTO projetos (nome, descricao) VALUES
  ('Otimização AWS', 'Projeto de redução de custos na AWS'),
  ('Migração GCP', 'Migração de workloads para Google Cloud'),
  ('Azure Governance', 'Governança e controle de custos Azure')
ON CONFLICT DO NOTHING;
