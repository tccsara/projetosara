<?php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=cabeca_dagua;charset=utf8mb4', 'root', '');
$stmt = $pdo->query('SELECT id, email, role, is_active, notifications_enabled FROM users ORDER BY id');
foreach ($stmt as $row) {
    echo $row['id'] . '|' . $row['email'] . '|' . $row['role'] . '|' . $row['is_active'] . '|' . $row['notifications_enabled'] . PHP_EOL;
}
