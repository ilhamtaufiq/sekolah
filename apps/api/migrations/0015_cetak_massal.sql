-- Cetak massal raport: satu job per kelas dan semester, diproses di latar belakang.
-- Status: antrean -> proses -> selesai | gagal. Siswa yang gagal dicatat di kolom errors.

CREATE TABLE report_jobs (
    id            BINARY(16) NOT NULL PRIMARY KEY,
    school_id     BINARY(16) NOT NULL,
    class_id      BINARY(16) NOT NULL,
    semester_id   BINARY(16) NOT NULL,
    status        VARCHAR(12) NOT NULL DEFAULT 'antrean',
    total         INT UNSIGNED NOT NULL DEFAULT 0,
    selesai       INT UNSIGNED NOT NULL DEFAULT 0,
    errors        JSON NULL,
    file_path     VARCHAR(255) NULL,
    error_message VARCHAR(500) NULL,
    created_by    BINARY(16) NOT NULL,
    created_at    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    started_at    DATETIME(6) NULL,
    finished_at   DATETIME(6) NULL,
    INDEX report_jobs_school_status_idx (school_id, status),
    INDEX report_jobs_school_created_idx (school_id, created_at),
    CONSTRAINT report_jobs_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT report_jobs_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT report_jobs_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id) ON DELETE CASCADE,
    CONSTRAINT report_jobs_creator_fk FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT report_jobs_status_check CHECK (status IN ('antrean', 'proses', 'selesai', 'gagal')),
    CONSTRAINT report_jobs_progress_check CHECK (selesai <= total)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
