-- Status aktif sekolah. Sekolah nonaktif tidak bisa login dan tidak bisa memakai token yang ada.
ALTER TABLE schools ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Jejak audit untuk setiap aksi super admin lintas sekolah.
CREATE TABLE platform_audit_logs (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    actor_id    BINARY(16) NOT NULL,
    action      VARCHAR(40) NOT NULL,
    school_id   BINARY(16) NULL,
    detail      TEXT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX platform_audit_school_idx (school_id, created_at),
    INDEX platform_audit_created_idx (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
