-- Akun super admin platform. Terpisah dari users (yang selalu terikat satu sekolah).
CREATE TABLE platform_admins (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    email           VARCHAR(190) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY platform_admins_email_uq (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
