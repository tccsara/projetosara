<?php

use PDO;

function handleTelegramWebhook(PDO $pdo): void
{
    $cfg = require __DIR__ . '/../config/config.php';
    $secret = $cfg['TELEGRAM_WEBHOOK_SECRET'] ?? '';

    if ($secret !== '') {
        $header = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
        if ($header !== $secret) {
            http_response_code(403);
            echo json_encode(['error' => 'invalid secret']);
            exit;
        }
    }

    $raw = file_get_contents('php://input');
    $update = json_decode($raw, true);
    if (!$update) {
        echo json_encode(['ok' => false, 'error' => 'invalid json']);
        exit;
    }

    $message = $update['message'] ?? $update['edited_message'] ?? null;
    if (!$message) {
        echo json_encode(['ok' => true]);
        exit;
    }

    $text = trim((string) ($message['text'] ?? ''));
    $chat = $message['chat'] ?? [];
    $chatId = $chat['id'] ?? null;

    if (!$chatId) {
        echo json_encode(['ok' => false, 'error' => 'no chat id']);
        exit;
    }

    require_once __DIR__ . '/../models/UserModel.php';
    require_once __DIR__ . '/../config/helpers.php';

    $userModel = new UserModel($pdo);

    $botCfg = require __DIR__ . '/../config/config.php';
    $botToken = $botCfg['TELEGRAM_BOT_TOKEN'] ?? '';
    if (empty($botToken)) {
        // cannot reply without token
        echo json_encode(['ok' => false, 'error' => 'bot token not configured']);
        exit;
    }

    if (stripos($text, '/start') === 0) {
        $reply = "Olá! Para vincular seu número ao sistema, envie:\n/cadastrar SEU_TELEFONE\n\nExemplo: /cadastrar 11999998888";
        telegram_send_to($botToken, (string) $chatId, $reply);
        echo json_encode(['ok' => true]);
        exit;
    }

    if (stripos($text, '/cadastrar') === 0) {
        $parts = preg_split('/\s+/', $text, 2);
        $phoneRaw = $parts[1] ?? '';
        $phoneDigits = preg_replace('/\D+/', '', $phoneRaw);
        if ($phoneDigits === '') {
            telegram_send_to($botToken, (string) $chatId, 'Número inválido. Envie: /cadastrar SEU_TELEFONE');
            echo json_encode(['ok' => false, 'error' => 'invalid phone']);
            exit;
        }

        $found = $userModel->findByPhone($phoneDigits);
        if (!$found) {
            telegram_send_to($botToken, (string) $chatId, 'Telefone não encontrado no sistema. Verifique se o número está cadastrado.');
            echo json_encode(['ok' => false, 'error' => 'phone not found']);
            exit;
        }

        $updated = $userModel->updateTelegramChatId((int) $found['id'], (string) $chatId);
        if ($updated) {
            telegram_send_to($botToken, (string) $chatId, 'Telefone vinculado com sucesso! Você passará a receber alertas.');
            echo json_encode(['ok' => true]);
            exit;
        }

        telegram_send_to($botToken, (string) $chatId, 'Não foi possível vincular o telefone. Tente novamente.');
        echo json_encode(['ok' => false, 'error' => 'update failed']);
        exit;
    }

    // Comando não reconhecido
    telegram_send_to($botToken, (string) $chatId, 'Comando não reconhecido. Use /start para instruções.');
    echo json_encode(['ok' => true]);
    exit;
}
