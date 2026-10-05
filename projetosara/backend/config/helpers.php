<?php

/**
 * Envia mensagem para um chat específico usando o bot
 */
function telegram_send_to(string $botToken, string $chatId, string $message, string $parseMode = 'HTML'): bool
{
    $url = sprintf('https://api.telegram.org/bot%s/sendMessage', $botToken);
    $payload = [
        'chat_id' => $chatId,
        'text' => $message,
        'parse_mode' => $parseMode,
    ];

    $options = [
        'http' => [
            'header' => "Content-Type: application/json\r\n",
            'method' => 'POST',
            'content' => json_encode($payload),
            'timeout' => 10,
        ],
    ];

    $context = stream_context_create($options);
    $result = @file_get_contents($url, false, $context);
    return $result !== false;
}

/**
 * Envia mensagem para todos os chat_ids cadastrados (e opcional TELEGRAM_CHAT_ID)
 */
function telegram_get_settings(PDO $pdo): array
{
    $settings = [];
    try {
        $stmt = $pdo->query('SELECT * FROM telegram_settings ORDER BY id DESC LIMIT 1');
        $settings = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
    } catch (Exception $e) {
        // tabela/coluna pode não existir ainda
    }
    return $settings;
}

function telegram_send(PDO $pdo, string $message): bool
{
    $cfg = require __DIR__ . '/config.php';
    $dbSettings = telegram_get_settings($pdo);
    $botToken = !empty($dbSettings['bot_token']) ? $dbSettings['bot_token'] : ($cfg['TELEGRAM_BOT_TOKEN'] ?? '');
    if (empty($botToken)) {
        return false;
    }

    $chatIds = [];
    if (!empty($dbSettings['chat_id'])) {
        $chatIds[] = $dbSettings['chat_id'];
    } elseif (!empty($cfg['TELEGRAM_CHAT_ID'])) {
        $chatIds[] = $cfg['TELEGRAM_CHAT_ID'];
    }

    try {
        $stmt = $pdo->query("SELECT DISTINCT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''");
        $rows = $stmt->fetchAll(PDO::FETCH_COLUMN);
        foreach ($rows as $cid) {
            if ($cid) {
                $chatIds[] = $cid;
            }
        }
    } catch (Exception $e) {
        // tabela/coluna pode não existir ainda
    }

    $chatIds = array_values(array_unique($chatIds));
    $ok = true;
    foreach ($chatIds as $cid) {
        if (!telegram_send_to($botToken, (string) $cid, $message)) {
            $ok = false;
        }
    }

    return $ok;
}

function telegram_set_webhook(string $botToken, string $webhookUrl): array
{
    $url = sprintf('https://api.telegram.org/bot%s/setWebhook', rawurlencode($botToken));
    $payload = http_build_query(['url' => $webhookUrl]);
    $options = [
        'http' => [
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'method' => 'POST',
            'content' => $payload,
            'timeout' => 10,
        ],
    ];
    $context = stream_context_create($options);
    $result = @file_get_contents($url, false, $context);
    $decoded = json_decode($result, true);
    if (is_array($decoded)) {
        return $decoded;
    }
    return ['ok' => false, 'description' => 'failed to set webhook', 'response' => $result];
}
