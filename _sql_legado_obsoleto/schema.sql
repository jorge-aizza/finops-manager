-- ============================================================
-- FinOps Manager — Schema PostgreSQL
-- Execute este script para criar o banco manualmente (opcional)
-- O servidor cria as tabelas automaticamente ao iniciar
-- ============================================================

-- Criar banco (execute fora do psql ou via pgAdmin)
-- CREATE DATABASE finops;

-- Tabela de Projetos
CREATE TABLE IF NOT EXISTS projetos (
    id          SERIAL PRIMARY KEY,
    nome        VARCHAR(200) NOT NULL,
    descricao   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Ações FinOps
CREATE TABLE IF NOT EXISTS acoes_finops (
    id                    SERIAL PRIMARY KEY,
    id_finops             VARCHAR(50) UNIQUE NOT NULL,
    projeto_id            INTEGER REFERENCES projetos(id) ON DELETE SET NULL,
    acao                  VARCHAR(300) NOT NULL,
    cloud                 VARCHAR(50),
    responsavel           VARCHAR(150),
    tipo_acao             VARCHAR(100),
    impacto_atual_mes     NUMERIC(15,2) DEFAULT 0,
    status                VARCHAR(50),
    data_inicio           DATE,
    data_conclusao        DATE,
    retorno_ano_atual     NUMERIC(15,2) DEFAULT 0,
    retorno_proximo_ano   NUMERIC(15,2) DEFAULT 0,

    -- Retornos mensais — Ano Atual
    atual_janeiro         NUMERIC(15,2) DEFAULT 0,
    atual_fevereiro       NUMERIC(15,2) DEFAULT 0,
    atual_marco           NUMERIC(15,2) DEFAULT 0,
    atual_abril           NUMERIC(15,2) DEFAULT 0,
    atual_maio            NUMERIC(15,2) DEFAULT 0,
    atual_junho           NUMERIC(15,2) DEFAULT 0,
    atual_julho           NUMERIC(15,2) DEFAULT 0,
    atual_agosto          NUMERIC(15,2) DEFAULT 0,
    atual_setembro        NUMERIC(15,2) DEFAULT 0,
    atual_outubro         NUMERIC(15,2) DEFAULT 0,
    atual_novembro        NUMERIC(15,2) DEFAULT 0,
    atual_dezembro        NUMERIC(15,2) DEFAULT 0,

    -- Retornos mensais — Próximo Ano
    proximo_janeiro       NUMERIC(15,2) DEFAULT 0,
    proximo_fevereiro     NUMERIC(15,2) DEFAULT 0,
    proximo_marco         NUMERIC(15,2) DEFAULT 0,
    proximo_abril         NUMERIC(15,2) DEFAULT 0,
    proximo_maio          NUMERIC(15,2) DEFAULT 0,
    proximo_junho         NUMERIC(15,2) DEFAULT 0,
    proximo_julho         NUMERIC(15,2) DEFAULT 0,
    proximo_agosto        NUMERIC(15,2) DEFAULT 0,
    proximo_setembro      NUMERIC(15,2) DEFAULT 0,
    proximo_outubro       NUMERIC(15,2) DEFAULT 0,
    proximo_novembro      NUMERIC(15,2) DEFAULT 0,
    proximo_dezembro      NUMERIC(15,2) DEFAULT 0,

    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_acoes_projeto   ON acoes_finops(projeto_id);
CREATE INDEX IF NOT EXISTS idx_acoes_status    ON acoes_finops(status);
CREATE INDEX IF NOT EXISTS idx_acoes_cloud     ON acoes_finops(cloud);
CREATE INDEX IF NOT EXISTS idx_acoes_id_finops ON acoes_finops(id_finops);

-- Dados de exemplo (opcional)
INSERT INTO projetos (nome, descricao) VALUES
  ('Otimização AWS', 'Projeto de rightsizing e reservas na AWS'),
  ('Governança Azure', 'Políticas de governança e tagueamento Azure'),
  ('Migração GCP', 'Otimização de custos durante migração para GCP')
ON CONFLICT DO NOTHING;
