-- 01_migracao_telegram.sql
-- Adiciona coluna telegram_chat_id e normaliza telefones (remove caracteres não numéricos)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64) NULL;

-- Normaliza telefones existentes: mantém apenas dígitos (MySQL 8+ necessário para REGEXP_REPLACE)
-- Se sua versão do MySQL não tem REGEXP_REPLACE, execute manualmente uma normalização apropriada.

UPDATE users
SET phone = TRIM(REGEXP_REPLACE(phone, '[^0-9]', ''))
WHERE phone IS NOT NULL AND phone <> '';

-- Opcional: torne a coluna phone maior/menor conforme o formato desejado
ALTER TABLE users
  MODIFY COLUMN phone VARCHAR(32) NULL;
