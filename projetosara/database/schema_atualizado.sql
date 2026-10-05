-- ============================================================
-- Projeto: Cabeça d'Água
-- schema.sql ATUALIZADO — reflete o estado real do banco em uso
-- Última atualização: 09/08/2026
--
-- Use este arquivo pra criar o banco do zero em qualquer máquina
-- nova (ex: outro computador, ou reinstalação do HeidiSQL).
-- Ele já inclui tudo que foi corrigido/adicionado ao longo do
-- desenvolvimento, então você não precisa rodar os SQLs de
-- migração separados depois — só este arquivo já deixa tudo
-- pronto.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `cabeca_dagua` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `cabeca_dagua`;

-- ------------------------------------------------------------
-- users
-- Email e phone são armazenados CRIPTOGRAFADOS pelo UserModel.php
-- (AES-256-CBC) — por isso os VARCHAR grandes. email_hash é um
-- HMAC-SHA256 usado pra permitir busca, já que o email cru não é
-- pesquisável diretamente.
-- ------------------------------------------------------------
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(512) NOT NULL,
  `phone` VARCHAR(512) DEFAULT NULL,
  `email_hash` VARCHAR(64) DEFAULT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('superadmin','developer','user') NOT NULL DEFAULT 'user',
  `notifications_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `telegram_chat_id` VARCHAR(64) DEFAULT NULL,   -- NOVO: vínculo com o bot do Telegram (via /cadastrar)
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email_hash` (`email_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- devices
-- ------------------------------------------------------------
CREATE TABLE `devices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `device_code` VARCHAR(60) NOT NULL UNIQUE,
  `name` VARCHAR(140) NOT NULL,
  `latitude` DECIMAL(10,7) NOT NULL DEFAULT '0.0000000',
  `longitude` DECIMAL(10,7) NOT NULL DEFAULT '0.0000000',
  `status` ENUM('online','offline') NOT NULL DEFAULT 'offline',
  `risk_level` ENUM('normal','attention','danger') NOT NULL DEFAULT 'normal',
  `last_update` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- device_logs
-- ------------------------------------------------------------
CREATE TABLE `device_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `device_id` INT UNSIGNED NOT NULL,
  `water_level` TINYINT UNSIGNED NOT NULL,
  `temperature` DECIMAL(5,2) NOT NULL,
  `battery` TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `latitude` DECIMAL(10,7) NOT NULL DEFAULT '0.0000000',
  `longitude` DECIMAL(10,7) NOT NULL DEFAULT '0.0000000',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_device_id` (`device_id`),
  CONSTRAINT `fk_device_logs_device` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- alerts
-- MUDANÇAS: coluna "source" adicionada (faltava, causava Fatal
-- Error ao gerar qualquer alerta) e 'manual' incluído no ENUM de
-- "type" (usado pelo botão de alerta manual do painel admin).
-- ------------------------------------------------------------
CREATE TABLE `alerts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `device_id` INT UNSIGNED NOT NULL,
  `type` ENUM('water_level','temperature','battery','manual') NOT NULL,
  `message` TEXT NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'automatic',   -- NOVO
  `telegram_sent` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alert_device` (`device_id`),
  CONSTRAINT `fk_alerts_device` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- telegram_settings
-- Guarda só bot_token e chat_id (não guarda URL de webhook —
-- essa fica em TELEGRAM_WEBHOOK_URL no config.php).
-- ------------------------------------------------------------
CREATE TABLE `telegram_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bot_token` VARCHAR(190) DEFAULT NULL,
  `chat_id` VARCHAR(80) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- alert_settings
-- ------------------------------------------------------------
CREATE TABLE `alert_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `auto_send` TINYINT(1) NOT NULL DEFAULT 1,
  `threshold_water_level` TINYINT UNSIGNED NOT NULL DEFAULT 75,
  `threshold_temperature` DECIMAL(5,2) NOT NULL DEFAULT 35.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- password_recovery_codes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_recovery_codes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `code` VARCHAR(6) NOT NULL,
  `channel` ENUM('email','phone') NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_password_recovery_user` (`user_id`),
  CONSTRAINT `fk_password_recovery_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- IMPORTANTE — NÃO insira uma linha placeholder em telegram_settings.
-- A versão antiga deste schema tinha:
--   INSERT INTO telegram_settings (bot_token, chat_id) VALUES ('YOUR_TELEGRAM_BOT_TOKEN', 'YOUR_CHAT_ID');
-- Isso causava um bug real: esse token falso tinha prioridade
-- sobre o token de verdade do config.php, e os alertas
-- automáticos falhavam silenciosamente. Deixe essa tabela vazia;
-- o token real já vem do config.php (TELEGRAM_BOT_TOKEN), e essa
-- tabela só é necessária se você configurar o bot pelo painel de
-- admin do sistema.
-- ------------------------------------------------------------
