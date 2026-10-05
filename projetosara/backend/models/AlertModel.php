<?php

class AlertModel
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->ensureSettings();
    }

    public function ensureSettings(): void
    {
        try {
            $this->pdo->query('SELECT 1 FROM alert_settings LIMIT 1');
        } catch (PDOException $exception) {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS alert_settings (id INT UNSIGNED NOT NULL AUTO_INCREMENT, auto_send TINYINT(1) NOT NULL DEFAULT 1, threshold_water_level TINYINT UNSIGNED NOT NULL DEFAULT 80, threshold_temperature DECIMAL(5,2) NOT NULL DEFAULT 35.00, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            $this->pdo->exec("INSERT INTO alert_settings (auto_send, threshold_water_level, threshold_temperature) VALUES (1, 80, 35.00)");
        }
    }

    public function create(int $deviceId, string $type, string $message, string $source = 'automatic')
    {
        $stmt = $this->pdo->prepare('INSERT INTO alerts (device_id, type, message, source, telegram_sent) VALUES (:device_id, :type, :message, :source, 0)');
        $stmt->execute(['device_id' => $deviceId, 'type' => $type, 'message' => $message, 'source' => $source]);
    }

    public function findRecent()
    {
        $stmt = $this->pdo->query('SELECT a.*, d.device_code FROM alerts a JOIN devices d ON d.id = a.device_id ORDER BY a.created_at DESC LIMIT 10');
        return $stmt->fetchAll();
    }

    public function getSettings(): array
    {
        $stmt = $this->pdo->query('SELECT * FROM alert_settings ORDER BY id DESC LIMIT 1');
        $settings = $stmt->fetch(PDO::FETCH_ASSOC);
        return $settings ?: ['auto_send' => 1, 'threshold_water_level' => 80, 'threshold_temperature' => 35.00];
    }

    public function saveSettings(array $settings): array
    {
        $current = $this->getSettings();
        $autoSend = isset($settings['auto_send']) ? (int) $settings['auto_send'] : (int) ($current['auto_send'] ?? 1);
        $waterThreshold = isset($settings['threshold_water_level']) ? (int) $settings['threshold_water_level'] : (int) ($current['threshold_water_level'] ?? 80);
        $tempThreshold = isset($settings['threshold_temperature']) ? (float) $settings['threshold_temperature'] : (float) ($current['threshold_temperature'] ?? 35.00);

        if (!empty($current['id'])) {
            $stmt = $this->pdo->prepare('UPDATE alert_settings SET auto_send = :auto_send, threshold_water_level = :threshold_water_level, threshold_temperature = :threshold_temperature WHERE id = :id');
            $stmt->execute(['auto_send' => $autoSend, 'threshold_water_level' => $waterThreshold, 'threshold_temperature' => $tempThreshold, 'id' => (int) $current['id']]);
        } else {
            $stmt = $this->pdo->prepare('INSERT INTO alert_settings (auto_send, threshold_water_level, threshold_temperature) VALUES (:auto_send, :threshold_water_level, :threshold_temperature)');
            $stmt->execute(['auto_send' => $autoSend, 'threshold_water_level' => $waterThreshold, 'threshold_temperature' => $tempThreshold]);
        }

        return $this->getSettings();
    }
}
