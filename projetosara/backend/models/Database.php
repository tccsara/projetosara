<?php

class Database
{
    private $config;

    public function __construct()
    {
        $this->config = require __DIR__ . '/../config/database.php';
    }

    public function connect()
    {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $this->config['host'], $this->config['db'], $this->config['charset']);
        try {
            $pdo = new PDO($dsn, $this->config['user'], $this->config['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            return $pdo;
        } catch (PDOException $exception) {
            echo json_encode(['error' => 'Falha na conexão ao banco de dados']);
            exit;
        }
    }
}
