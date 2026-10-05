<?php

class DeviceModel
{
    private $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    public function findByCode(string $deviceCode)
    {
        $stmt = $this->pdo->prepare('SELECT * FROM devices WHERE device_code = :code LIMIT 1');
        $stmt->execute(['code' => $deviceCode]);
        return $stmt->fetch();
    }

    public function create(array $data)
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO devices (device_code, name, latitude, longitude, status, risk_level) VALUES (:device_code, :name, :latitude, :longitude, :status, :risk_level)'
        );
        $stmt->execute([
            'device_code' => $data['device_code'],
            'name' => $data['name'],
            'latitude' => $data['latitude'],
            'longitude' => $data['longitude'],
            'status' => $data['status'],
            'risk_level' => $data['risk_level'],
        ]);

        return $this->findByCode($data['device_code']);
    }

    public function updateStatus(int $deviceId, string $status, float $latitude, float $longitude)
    {
        $stmt = $this->pdo->prepare(
            'UPDATE devices SET status = :status, latitude = :latitude, longitude = :longitude, last_update = NOW() WHERE id = :id'
        );
        $stmt->execute(['status' => $status, 'latitude' => $latitude, 'longitude' => $longitude, 'id' => $deviceId]);
    }

    public function updateRiskLevel(int $deviceId, string $riskLevel)
    {
        $stmt = $this->pdo->prepare('UPDATE devices SET risk_level = :risk_level WHERE id = :id');
        $stmt->execute(['risk_level' => $riskLevel, 'id' => $deviceId]);
    }

    public function saveLog(int $deviceId, array $payload)
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO device_logs (device_id, water_level, temperature, battery, latitude, longitude) VALUES (:device_id, :water_level, :temperature, :battery, :latitude, :longitude)'
        );
        $stmt->execute([
            'device_id' => $deviceId,
            'water_level' => $payload['water_level'],
            'temperature' => $payload['temperature'],
            'battery' => $payload['battery'],
            'latitude' => $payload['latitude'],
            'longitude' => $payload['longitude'],
        ]);
    }

    public function findAll()
    {
        $stmt = $this->pdo->query('SELECT * FROM devices ORDER BY last_update DESC');
        return $stmt->fetchAll();
    }

    public function findRecentLogs()
    {
        $stmt = $this->pdo->query('SELECT l.*, d.device_code, d.name FROM device_logs l JOIN devices d ON d.id = l.device_id ORDER BY l.created_at DESC LIMIT 20');
        return $stmt->fetchAll();
    }
}
