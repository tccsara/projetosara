<?php

class UserModel
{
    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
        $this->ensureUserColumns();
    }

    private function ensureUserColumns(): void
    {
        $columns = $this->pdo->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('email_hash', $columns, true)) {
            $this->pdo->exec('ALTER TABLE users ADD COLUMN email_hash VARCHAR(64) NULL');
        }
        if (!in_array('notifications_enabled', $columns, true)) {
            $this->pdo->exec('ALTER TABLE users ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 1');
        }
        if (!in_array('is_active', $columns, true)) {
            $this->pdo->exec('ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
        }
        if (!in_array('telegram_chat_id', $columns, true)) {
            $this->pdo->exec("ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(64) NULL");
        }

        try {
            $this->pdo->exec("ALTER TABLE users MODIFY COLUMN role ENUM('superadmin','developer','user') NOT NULL DEFAULT 'user'");
        } catch (PDOException $exception) {
            // Ignore if the table already uses a compatible definition.
        }

        try {
            $this->pdo->exec('ALTER TABLE users ADD UNIQUE INDEX uq_users_email_hash (email_hash)');
        } catch (PDOException $exception) {
            // Ignore if the index already exists.
        }

        try {
            $this->pdo->exec("CREATE TABLE IF NOT EXISTS password_recovery_codes (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                user_id INT UNSIGNED NOT NULL,
                code VARCHAR(6) NOT NULL,
                channel ENUM('email','phone') NOT NULL,
                expires_at DATETIME NOT NULL,
                used TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_password_recovery_user (user_id),
                CONSTRAINT fk_password_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        } catch (PDOException $exception) {
            // Ignore if the table already exists.
        }

        $rows = $this->pdo->query('SELECT id, email, phone, role FROM users WHERE email_hash IS NULL OR email_hash = ""')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $decryptedEmail = $this->decryptValue($row['email'] ?? null) ?? null;
            $normalizedEmail = $decryptedEmail ?? $row['email'];
            $role = self::normalizeRole($row['role'] ?? null);
            if ($normalizedEmail && strtolower(trim((string) $normalizedEmail)) === 'superadmin@cabecadagua.com') {
                $role = 'superadmin';
            }

            $this->pdo->prepare('UPDATE users SET email = :email, phone = :phone, email_hash = :email_hash, role = :role WHERE id = :id')->execute([
                ':email' => $this->normalizeStoredValue($normalizedEmail),
                ':phone' => $this->normalizeStoredValue($row['phone'] ?? null),
                ':email_hash' => $this->buildEmailHash((string) $normalizedEmail),
                ':role' => $role,
                ':id' => (int) $row['id'],
            ]);
        }
    }

    public function ensureDefaultSuperadmin(): void
    {
        $existing = $this->findByEmail('enzobianchini17@gmail.com');
        if ($existing) {
            $this->update((int) $existing['id'], [
                'role' => 'superadmin',
                'is_active' => 1,
                'notifications_enabled' => 1,
            ]);
            return;
        }

        $this->create([
            'name' => 'Super Admin',
            'email' => 'enzobianchini17@gmail.com',
            'phone' => null,
            'password' => '123456789',
            'role' => 'superadmin',
            'notifications_enabled' => 1,
            'is_active' => 1,
        ]);
    }

    public function create(array $data): array
    {
        $sql = 'INSERT INTO users (name, email, phone, email_hash, password, role, notifications_enabled, is_active) VALUES (:name, :email, :phone, :email_hash, :password, :role, :notifications_enabled, :is_active)';
        $stmt = $this->pdo->prepare($sql);
        // Normaliza telefone para apenas dígitos antes de armazenar
        $rawPhone = (string) ($data['phone'] ?? '');
        $phoneDigits = preg_replace('/\D+/', '', $rawPhone);
        $phoneToStore = $phoneDigits === '' ? null : $phoneDigits;

        $stmt->execute([
            ':name' => $data['name'],
            ':email' => $this->normalizeStoredValue($data['email'] ?? null),
            ':phone' => $this->normalizeStoredValue($phoneToStore),
            ':email_hash' => $this->buildEmailHash($data['email'] ?? ''),
            ':password' => password_hash($data['password'], PASSWORD_DEFAULT),
            ':role' => self::normalizeRole($data['role'] ?? 'user'),
            ':notifications_enabled' => isset($data['notifications_enabled']) ? (int) $data['notifications_enabled'] : 1,
            ':is_active' => isset($data['is_active']) ? (int) $data['is_active'] : 1,
        ]);

        return $this->findById((int) $this->pdo->lastInsertId());
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        return $user ? $this->decryptUser($user) : null;
    }

    public function findByEmail(string $email): ?array
    {
        $emailHash = $this->buildEmailHash($email);
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE email_hash = :email_hash LIMIT 1');
        $stmt->execute([':email_hash' => $emailHash]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($user) {
            return $this->decryptUser($user);
        }

        $fallbackStmt = $this->pdo->prepare('SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(:email)) LIMIT 1');
        $fallbackStmt->execute([':email' => trim($email)]);
        $fallbackUser = $fallbackStmt->fetch(PDO::FETCH_ASSOC);
        return $fallbackUser ? $this->decryptUser($fallbackUser) : null;
    }

    public function findAll(): array
    {
        $stmt = $this->pdo->query('SELECT id, name, email, phone, email_hash, role, notifications_enabled, is_active, created_at FROM users ORDER BY created_at DESC');
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return array_map(fn (array $user) => $this->decryptUser($user), $rows);
    }

    public function update(int $id, array $data): ?array
    {
        $fields = [];
        $params = [':id' => $id];

        if (array_key_exists('name', $data)) {
            $fields[] = 'name = :name';
            $params[':name'] = $data['name'];
        }

        if (array_key_exists('email', $data)) {
            $fields[] = 'email = :email';
            $params[':email'] = $this->normalizeStoredValue($data['email']);
            $fields[] = 'email_hash = :email_hash';
            $params[':email_hash'] = $this->buildEmailHash($data['email']);
        }

        if (array_key_exists('phone', $data)) {
            $fields[] = 'phone = :phone';
            $params[':phone'] = $this->normalizeStoredValue($data['phone']);
        }

        if (array_key_exists('password', $data)) {
            $fields[] = 'password = :password';
            $params[':password'] = password_hash($data['password'], PASSWORD_DEFAULT);
        }

        if (array_key_exists('role', $data)) {
            $fields[] = 'role = :role';
            $params[':role'] = self::normalizeRole($data['role']);
        }

        if (array_key_exists('notifications_enabled', $data)) {
            $fields[] = 'notifications_enabled = :notifications_enabled';
            $params[':notifications_enabled'] = (int) $data['notifications_enabled'];
        }

        if (array_key_exists('is_active', $data)) {
            $fields[] = 'is_active = :is_active';
            $params[':is_active'] = (int) $data['is_active'];
        }

        if (!$fields) {
            return $this->findById($id);
        }

        $sql = 'UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = :id';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public function createRecoveryCode(int $userId, string $channel): string
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $this->pdo->prepare('DELETE FROM password_recovery_codes WHERE user_id = :user_id')->execute([':user_id' => $userId]);
        $stmt = $this->pdo->prepare('INSERT INTO password_recovery_codes (user_id, code, channel, expires_at) VALUES (:user_id, :code, :channel, DATE_ADD(NOW(), INTERVAL 15 MINUTE))');
        $stmt->execute([
            ':user_id' => $userId,
            ':code' => $code,
            ':channel' => $channel,
        ]);
        return $code;
    }

    public function verifyRecoveryCode(int $userId, string $code): bool
    {
        $stmt = $this->pdo->prepare('SELECT id FROM password_recovery_codes WHERE user_id = :user_id AND code = :code AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1');
        $stmt->execute([
            ':user_id' => $userId,
            ':code' => $code,
        ]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return false;
        }

        $this->pdo->prepare('UPDATE password_recovery_codes SET used = 1 WHERE id = :id')->execute([':id' => (int) $row['id']]);
        return true;
    }

    public function verifyPassword(string $password, string $hash): bool
    {
        if (empty($hash)) {
            return false;
        }
        return password_verify($password, $hash);
    }

    public function publicUser(?array $user): ?array
    {
        if (!$user) {
            return null;
        }

        unset($user['password'], $user['email_hash']);
        return $user;
    }

    private function buildEmailHash(string $email): string
    {
        $config = require __DIR__ . '/../config/jwt.php';
        return hash_hmac('sha256', strtolower(trim($email)), (string) ($config['encryption_key'] ?? 'cabeca-dagua-2026-encryption-key'));
    }

    private function normalizeStoredValue(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return $this->isEncryptedValue($value) ? $value : $this->encryptValue($value);
    }

    private function decryptValue(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (!$this->isEncryptedValue($value)) {
            return $value;
        }

        $config = require __DIR__ . '/../config/jwt.php';
        $key = substr(hash('sha256', (string) ($config['encryption_key'] ?? 'cabeca-dagua-2026-encryption-key'), true), 0, 32);
        $data = base64_decode($value, true);
        if ($data === false || strlen($data) < 16) {
            return $value;
        }

        $iv = substr($data, 0, 16);
        $cipherText = substr($data, 16);
        $decrypted = openssl_decrypt($cipherText, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        return $decrypted === false ? $value : $decrypted;
    }

    private function encryptValue(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $config = require __DIR__ . '/../config/jwt.php';
        $key = substr(hash('sha256', (string) ($config['encryption_key'] ?? 'cabeca-dagua-2026-encryption-key'), true), 0, 32);
        $iv = openssl_random_pseudo_bytes(16);
        $cipherText = openssl_encrypt($value, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        return $cipherText === false ? null : base64_encode($iv . $cipherText);
    }

    private function isEncryptedValue(?string $value): bool
    {
        if ($value === null || $value === '') {
            return false;
        }

        $decoded = base64_decode($value, true);
        if ($decoded === false || strlen($decoded) < 16) {
            return false;
        }

        return true;
    }

    private function decryptUser(array $user): array
    {
        if (isset($user['email'])) {
            $user['email'] = $this->decryptValue($user['email']) ?? null;
        }
        if (isset($user['phone'])) {
            $user['phone'] = $this->decryptValue($user['phone']) ?? null;
        }
        return $user;
    }

    public function findByPhone(string $phone): ?array
    {
        $digits = preg_replace('/\D+/', '', $phone);
        if ($digits === '') {
            return null;
        }

        $stmt = $this->pdo->query('SELECT * FROM users');
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $stored = $row['phone'] ?? null;
            $decrypted = $this->decryptValue($stored) ?? null;
            $storedDigits = $decrypted === null ? '' : preg_replace('/\D+/', '', $decrypted);
            if ($storedDigits !== '' && $storedDigits === $digits) {
                return $this->decryptUser($row);
            }
        }

        return null;
    }

    public function updateTelegramChatId(int $userId, string $chatId): bool
    {
        $stmt = $this->pdo->prepare('UPDATE users SET telegram_chat_id = :chat WHERE id = :id');
        $stmt->execute([':chat' => $chatId, ':id' => $userId]);
        return $stmt->rowCount() > 0;
    }

    public function listTelegramChatIds(): array
    {
        try {
            $stmt = $this->pdo->query("SELECT DISTINCT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id <> ''");
            $rows = $stmt->fetchAll(PDO::FETCH_COLUMN);
            return array_values(array_filter($rows));
        } catch (Exception $e) {
            return [];
        }
    }

    public static function normalizeRole(?string $role): string
    {
        $role = strtolower(trim((string) $role));
        if (in_array($role, ['superadmin', 'admin', 'authority'], true)) {
            return 'superadmin';
        }

        if ($role === 'developer') {
            return 'developer';
        }

        return 'user';
    }

    public static function isStaffRole(?string $role): bool
    {
        return in_array(self::normalizeRole($role), ['superadmin', 'developer'], true);
    }
}
