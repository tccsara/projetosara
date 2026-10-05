<?php

class TelegramModel
{
    private $pdo;
    private $settings;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->loadSettings();
    }

    private function loadSettings()
    {
        $stmt = $this->pdo->query('SELECT * FROM telegram_settings ORDER BY id DESC LIMIT 1');
        $this->settings = $stmt->fetch();
    }

    public function sendMessage(string $message, ?string $chatId = null)
    {
        if (empty($this->settings['bot_token'])) {
            return false;
        }

        $targetChatId = $chatId ?: ($this->settings['chat_id'] ?? '');
        if (empty($targetChatId)) {
            return false;
        }

        $url = sprintf(
            'https://api.telegram.org/bot%s/sendMessage',
            $this->settings['bot_token']
        );

        $payload = [
            'chat_id' => $targetChatId,
            'text' => $message,
            'parse_mode' => 'HTML',
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

    public function getSettings(): array
    {
        return $this->settings ?: ['bot_token' => null, 'chat_id' => null];
    }

    public function saveSettings(array $data): array
    {
        $stmt = $this->pdo->prepare('INSERT INTO telegram_settings (bot_token, chat_id) VALUES (:bot_token, :chat_id)');
        $stmt->execute([
            ':bot_token' => trim((string) ($data['bot_token'] ?? '')),
            ':chat_id' => trim((string) ($data['chat_id'] ?? '')),
        ]);

        $this->loadSettings();
        return $this->getSettings();
    }
}

