<?php
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../models/Database.php';
require_once __DIR__ . '/../models/DeviceModel.php';
require_once __DIR__ . '/../models/AlertModel.php';
require_once __DIR__ . '/../models/TelegramModel.php';
require_once __DIR__ . '/../models/UserModel.php';
require_once __DIR__ . '/../config/jwt.php';
require_once __DIR__ . '/../config/helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = isset($_GET['route']) ? $_GET['route'] : '';

$database = new Database();
$pdo = $database->connect();
$deviceModel = new DeviceModel($pdo);
$alertModel = new AlertModel($pdo);
$telegramModel = new TelegramModel($pdo);
$userModel = new UserModel($pdo);
$userModel->ensureDefaultSuperadmin();

function sendJson($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function readJson(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return $_POST;
    }

    $decoded = json_decode($raw, true);
    if (is_array($decoded) && $decoded !== []) {
        return $decoded;
    }

    $parsed = [];
    parse_str($raw, $parsed);
    if ($parsed !== []) {
        return $parsed;
    }

    $fallback = [];
    foreach ($_POST as $key => $value) {
        $fallback[$key] = $value;
    }
    return $fallback;
}

function getBearerToken(): ?string {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $key => $value) {
            if (strtolower($key) === 'authorization') {
                $header = $value;
                break;
            }
        }
    }

    if (preg_match('/Bearer\s+(\S+)/', $header, $matches)) {
        return $matches[1];
    }
    return null;
}

function createJwt(array $payload): string {
    $config = require __DIR__ . '/../config/jwt.php';
    $header = rtrim(strtr(base64_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256'])), '+/', '-_'), '=');
    $now = time();
    $body = [
        'iss' => $config['issuer'],
        'aud' => $config['audience'],
        'iat' => $now,
        'nbf' => $now,
        'exp' => $now + $config['expires_in'],
        'sub' => $payload['sub'],
        'email' => $payload['email'],
        'role' => $payload['role'],
    ];
    $payloadBase64 = rtrim(strtr(base64_encode(json_encode($body)), '+/', '-_'), '=');
    $signature = hash_hmac('sha256', "$header.$payloadBase64", $config['secret'], true);
    return sprintf('%s.%s.%s', $header, $payloadBase64, rtrim(strtr(base64_encode($signature), '+/', '-_'), '='));
}

function decodeJwt(string $token): ?array {
    $config = require __DIR__ . '/../config/jwt.php';
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$header, $payload, $signature] = $parts;
    $expected = hash_hmac('sha256', "$header.$payload", $config['secret'], true);
    $expectedSignature = rtrim(strtr(base64_encode($expected), '+/', '-_'), '=');
    if (!hash_equals($expectedSignature, $signature)) {
        return null;
    }

    $decodedPayload = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    if (!$decodedPayload) {
        return null;
    }
    if (($decodedPayload['exp'] ?? 0) < time()) {
        return null;
    }
    return $decodedPayload;
}

function requireAuth(): ?array {
    global $userModel;
    $token = getBearerToken();
    if (!$token) {
        return null;
    }
    $decoded = decodeJwt($token);
    if (!$decoded) {
        return null;
    }

    $user = $userModel->findById((int) ($decoded['sub'] ?? 0));
    if (!$user) {
        $user = $userModel->findByEmail((string) ($decoded['email'] ?? ''));
    }

    $decodedEmail = strtolower(trim((string) ($decoded['email'] ?? '')));
    $storedEmail = strtolower(trim((string) ($user['email'] ?? '')));
    if (!$user || ($decodedEmail !== '' && $storedEmail !== '' && $storedEmail !== $decodedEmail) || !$user['is_active']) {
        return null;
    }
    return $user;
}

if ($method === 'POST' && $route === 'auth/register') {
    $payload = readJson();
    $phone = trim((string) ($payload['phone'] ?? ''));
    if (empty($payload['name']) || empty($payload['email']) || $phone === '' || empty($payload['password'])) {
        sendJson(['error' => 'Nome, e-mail, telefone e senha são obrigatórios'], 400);
    }

    if ($userModel->findByEmail($payload['email'])) {
        sendJson(['error' => 'E-mail já cadastrado'], 409);
    }

    $user = $userModel->create([
        'name' => $payload['name'],
        'email' => $payload['email'],
        'phone' => $phone,
        'password' => $payload['password'],
        'role' => $payload['role'] ?? 'user',
        'notifications_enabled' => $payload['notifications_enabled'] ?? 1,
        'is_active' => 1,
    ]);

    sendJson(['user' => $userModel->publicUser($user), 'token' => createJwt(['sub' => $user['id'], 'email' => $user['email'], 'role' => $user['role']])]);
}

if ($method === 'POST' && $route === 'auth/login') {
    $payload = readJson();
    $email = trim((string) ($payload['email'] ?? ''));
    $password = (string) ($payload['password'] ?? '');

    if ($email === '' || $password === '') {
        sendJson(['error' => 'E-mail e senha são obrigatórios'], 400);
    }

    $user = $userModel->findByEmail($email);
    if (!$user) {
        $user = $userModel->findByEmail(strtolower($email));
    }

    if (!$user || !$userModel->verifyPassword($password, $user['password']) || !$user['is_active']) {
        sendJson(['error' => 'Credenciais inválidas ou usuário inativo'], 401);
    }

    sendJson(['user' => $userModel->publicUser($user), 'token' => createJwt(['sub' => $user['id'], 'email' => $user['email'], 'role' => $user['role']])]);
}

if ($method === 'GET' && $route === 'auth/me') {
    $user = requireAuth();
    if (!$user) {
        sendJson(['error' => 'Não autenticado'], 401);
    }
    sendJson(['user' => $userModel->publicUser($user)]);
}

if ($method === 'GET' && $route === 'users') {
    $user = requireAuth();
    if (!$user || !UserModel::isStaffRole($user['role'])) {
        sendJson(['users' => $userModel->findAll()]);
    }

    sendJson(['users' => $userModel->findAll()]);
}

if ($method === 'POST' && $route === 'users') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    $phone = trim((string) ($payload['phone'] ?? ''));
    if (empty($payload['name']) || empty($payload['email']) || $phone === '' || empty($payload['password'])) {
        sendJson(['error' => 'Nome, e-mail, telefone e senha são obrigatórios'], 400);
    }

    $existing = $userModel->findByEmail($payload['email']);
    if ($existing) {
        sendJson(['error' => 'E-mail já cadastrado'], 409);
    }

    $created = $userModel->create([
        'name' => $payload['name'],
        'email' => $payload['email'],
        'phone' => $phone,
        'password' => $payload['password'],
        'role' => $payload['role'] ?? 'user',
        'notifications_enabled' => $payload['notifications_enabled'] ?? 1,
        'is_active' => $payload['is_active'] ?? 1,
    ]);

    sendJson(['user' => $userModel->publicUser($created)]);
}

if ($method === 'PUT' && $route === 'users') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    $id = (int) ($payload['id'] ?? 0);
    if (!$id) {
        sendJson(['error' => 'ID do usuário é obrigatório'], 400);
    }

    $updated = $userModel->update($id, $payload);
    if (!$updated) {
        sendJson(['error' => 'Usuário não encontrado'], 404);
    }

    sendJson(['user' => $userModel->publicUser($updated)]);
}

if ($method === 'DELETE' && $route === 'users') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $id = (int) ($_GET['id'] ?? 0);
    if (!$id) {
        sendJson(['error' => 'ID do usuário é obrigatório'], 400);
    }

    $deleted = $userModel->delete($id);
    if (!$deleted) {
        sendJson(['error' => 'Usuário não encontrado'], 404);
    }

    sendJson(['success' => true]);
}

if ($method === 'POST' && $route === 'device/send-data') {
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!$payload) {
        sendJson(['error' => 'JSON inválido'], 400);
    }

    $required = ['device_id', 'water_level', 'temperature', 'latitude', 'longitude', 'battery'];
    foreach ($required as $field) {
        if (!isset($payload[$field])) {
            sendJson(['error' => "Campo ausente: $field"], 400);
        }
    }

    $device = $deviceModel->findByCode($payload['device_id']);
    if (!$device) {
        $device = $deviceModel->create([ 
            'device_code' => $payload['device_id'],
            'name' => 'Dispositivo ' . $payload['device_id'],
            'latitude' => $payload['latitude'],
            'longitude' => $payload['longitude'],
            'status' => 'online',
            'risk_level' => 'normal',
        ]);
    }

    $previousRisk = $device['risk_level'] ?? 'normal';
    $deviceModel->updateStatus($device['id'], 'online', $payload['latitude'], $payload['longitude']);
    $deviceModel->saveLog($device['id'], $payload);

    $status = strtoupper((string) ($payload['status'] ?? ''));
    $risk = 'normal';
    if ($status === 'PERIGO' || $payload['water_level'] >= 80) {
        $risk = 'danger';
    } elseif ($status === 'ALERTA' || $payload['water_level'] >= 70) {
        $risk = 'attention';
    }
    $deviceModel->updateRiskLevel($device['id'], $risk);

    $alertSettings = $alertModel->getSettings();
    $shouldSendTelegram = (int) ($alertSettings['auto_send'] ?? 1) === 1
        && $risk !== 'normal'
        && $risk !== $previousRisk;

    if ($shouldSendTelegram) {
        if ($risk === 'danger') {
            $title = '⚠️ ALTO RISCO DE CABEÇA D\'ÁGUA';
        } else {
            $title = '⚠ ALERTA DE RISCO DE CABEÇA D\'ÁGUA';
        }

        $message = sprintf(
            "%s\n\nDispositivo: %s\nStatus: %s\nNível: %s%%\nDistância: %s cm\nTemperatura: %s°C\n\nLocalização:\nhttps://maps.google.com/?q=%s,%s",
            $title,
            $device['device_code'],
            $status !== '' ? $status : $risk,
            $payload['water_level'],
            isset($payload['distance_cm']) ? $payload['distance_cm'] : 'indisponível',
            $payload['temperature'],
            $payload['latitude'],
            $payload['longitude']
        );
        $alertModel->create($device['id'], 'water_level', $message);
        // Envia para todos os chat_ids cadastrados (helpers.php)
        telegram_send($pdo, $message);
    }

    sendJson(['success' => true]);
}

if ($method === 'GET' && $route === 'alerts/settings') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    sendJson(['settings' => $alertModel->getSettings()]);
}

if ($method === 'POST' && $route === 'alerts/settings') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    sendJson(['settings' => $alertModel->saveSettings($payload)]);
}

if ($method === 'POST' && $route === 'alerts/send') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    $device = $deviceModel->findByCode($payload['device_id'] ?? '');
    if (!$device) {
        sendJson(['error' => 'Dispositivo não encontrado'], 404);
    }

    $message = $payload['message'] ?? '⚠ Alerta manual enviado pelo superadmin.';
    $alertModel->create($device['id'], 'manual', $message, 'manual');
    telegram_send($pdo, $message);

    sendJson(['success' => true, 'message' => $message]);
}

if ($method === 'GET' && $route === 'telegram/settings') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    sendJson(['settings' => $telegramModel->getSettings()]);
}

if ($method === 'POST' && $route === 'telegram/settings') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    if (empty(trim((string) ($payload['bot_token'] ?? '')))) {
        sendJson(['error' => 'bot_token é obrigatório'], 400);
    }

    $settings = $telegramModel->saveSettings([
        'bot_token' => $payload['bot_token'],
        'chat_id' => $payload['chat_id'] ?? '',
    ]);

    sendJson(['settings' => $settings]);
}

if ($method === 'POST' && $route === 'telegram/send') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $payload = readJson();
    $message = trim((string) ($payload['message'] ?? ''));
    if ($message === '') {
        sendJson(['error' => 'message é obrigatório'], 400);
    }

    $chatId = trim((string) ($payload['chat_id'] ?? ''));
    if ($chatId !== '') {
        $settings = $telegramModel->getSettings();
        $botToken = $settings['bot_token'] ?? '';
        if (empty($botToken)) {
            sendJson(['error' => 'bot_token não configurado'], 400);
        }
        $sent = telegram_send_to($botToken, $chatId, $message);
    } else {
        $sent = telegram_send($pdo, $message);
    }

    if (!$sent) {
        sendJson(['error' => 'Falha ao enviar mensagem'], 500);
    }

    sendJson(['success' => true, 'message' => $message]);
}

if ($method === 'POST' && $route === 'telegram/setup-webhook') {
    $user = requireAuth();
    if (!$user || $user['role'] !== 'superadmin') {
        sendJson(['error' => 'Acesso negado'], 403);
    }

    $cfg = require __DIR__ . '/../config/config.php';
    $botToken = trim((string) ($cfg['TELEGRAM_BOT_TOKEN'] ?? ''));
    $webhookUrl = trim((string) ($cfg['TELEGRAM_WEBHOOK_URL'] ?? ''));

    if ($botToken === '' || $webhookUrl === '') {
        sendJson(['error' => 'TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_URL devem estar configurados'], 400);
    }

    $response = telegram_set_webhook($botToken, $webhookUrl);
    sendJson(['success' => $response['ok'] ?? false, 'response' => $response]);
}

// Telegram webhook endpoint
if ($method === 'POST' && $route === 'telegram/webhook') {
    require_once __DIR__ . '/../controllers/TelegramController.php';
    // Controller will echo response and exit
    handleTelegramWebhook($pdo);
}

if ($method === 'GET' && $route === 'dashboard/data') {
    $devices = $deviceModel->findAll();
    $logs = $deviceModel->findRecentLogs();
    $alerts = $alertModel->findRecent();

    if (!$devices) {
        $devices = [
            ['id' => 1, 'device_code' => 'CDA-001', 'name' => 'Sensor 1', 'latitude' => -23.185, 'longitude' => -46.876, 'status' => 'online', 'risk_level' => 'normal', 'last_update' => date('Y-m-d H:i:s')],
            ['id' => 2, 'device_code' => 'CDA-002', 'name' => 'Sensor 2', 'latitude' => -23.190, 'longitude' => -46.870, 'status' => 'online', 'risk_level' => 'attention', 'last_update' => date('Y-m-d H:i:s')],
            ['id' => 3, 'device_code' => 'CDA-003', 'name' => 'Sensor 3', 'latitude' => -23.178, 'longitude' => -46.883, 'status' => 'online', 'risk_level' => 'danger', 'last_update' => date('Y-m-d H:i:s')],
        ];
        $logs = [
            ['id' => 1, 'device_id' => 1, 'water_level' => 40, 'temperature' => 24.5, 'battery' => 92, 'latitude' => -23.185, 'longitude' => -46.876, 'created_at' => date('Y-m-d H:i:s')],
            ['id' => 2, 'device_id' => 2, 'water_level' => 58, 'temperature' => 27.1, 'battery' => 88, 'latitude' => -23.190, 'longitude' => -46.870, 'created_at' => date('Y-m-d H:i:s')],
            ['id' => 3, 'device_id' => 3, 'water_level' => 82, 'temperature' => 30.2, 'battery' => 81, 'latitude' => -23.178, 'longitude' => -46.883, 'created_at' => date('Y-m-d H:i:s')],
        ];
        $alerts = [
            ['id' => 1, 'device_id' => 3, 'type' => 'water_level', 'message' => 'Nível crítico no Sensor 3', 'telegram_sent' => 0, 'created_at' => date('Y-m-d H:i:s')],
        ];
    }
    sendJson(['devices' => $devices, 'logs' => $logs, 'alerts' => $alerts, 'server_time' => date('Y-m-d H:i:s')]);
}

sendJson(['error' => 'Rota não encontrada'], 404);
