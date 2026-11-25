-- Tenant: setiap sekolah adalah satu tenant. Semua data sekolah membawa school_id.
-- UUID disimpan sebagai BINARY(16), sesuai pemetaan native sqlx untuk uuid::Uuid.
-- Waktu disimpan dalam UTC (DATETIME(6), diisi dengan UTC_TIMESTAMP(6)).

CREATE TABLE schools (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    slug        VARCHAR(40) NOT NULL,
    name        VARCHAR(200) NOT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY schools_slug_uq (slug),
    CONSTRAINT schools_slug_format CHECK (slug REGEXP '^[a-z0-9-]{3,40}$')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE users (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    email          VARCHAR(255) NOT NULL,
    name           VARCHAR(200) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(20) NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY users_school_email_uq (school_id, email),
    CONSTRAINT users_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT users_role_check CHECK (role IN (
        'admin', 'kepala_sekolah', 'guru', 'wali_kelas', 'siswa', 'orang_tua'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Pengaturan format raport aktif per sekolah. Satu baris per sekolah.
CREATE TABLE report_format_settings (
    school_id   BINARY(16) NOT NULL PRIMARY KEY,
    version     INT NOT NULL,
    config      JSON NOT NULL,
    updated_by  BINARY(16) NULL,
    updated_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT rfs_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT rfs_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT rfs_version_check CHECK (version >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Riwayat append-only. Aplikasi tidak pernah mengubah atau menghapus baris di sini.
CREATE TABLE report_format_history (
    id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    version     INT NOT NULL,
    config      JSON NOT NULL,
    action      VARCHAR(10) NOT NULL,
    changed_by  BINARY(16) NULL,
    changed_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY rfh_school_version_uq (school_id, version),
    INDEX rfh_school_changed_idx (school_id, changed_at),
    CONSTRAINT rfh_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT rfh_changed_by_fk FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT rfh_action_check CHECK (action IN ('update', 'restore'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
