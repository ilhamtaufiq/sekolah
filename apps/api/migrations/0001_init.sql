-- Tenant: setiap sekolah adalah satu tenant. Semua data sekolah membawa school_id.

CREATE TABLE schools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id      UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    email          TEXT NOT NULL,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN (
                       'admin', 'kepala_sekolah', 'guru', 'wali_kelas', 'siswa', 'orang_tua')),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (school_id, email)
);

-- Pengaturan format raport aktif per sekolah. Satu baris per sekolah.
CREATE TABLE report_format_settings (
    school_id   UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL CHECK (version >= 1),
    config      JSONB NOT NULL,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Riwayat append-only. Tidak pernah diubah atau dihapus oleh aplikasi.
CREATE TABLE report_format_history (
    id          BIGSERIAL PRIMARY KEY,
    school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    config      JSONB NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('update', 'restore')),
    changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (school_id, version)
);

CREATE INDEX report_format_history_school_idx
    ON report_format_history (school_id, changed_at DESC);
