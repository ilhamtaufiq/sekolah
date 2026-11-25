-- Materi video YouTube dan progres tonton siswa. Selesai = 100% durasi (toleransi 1 detik).
ALTER TABLE lms_materials ADD COLUMN youtube_id VARCHAR(20) NULL;

CREATE TABLE lms_video_progress (
    material_id       BINARY(16) NOT NULL,
    student_id        BINARY(16) NOT NULL,
    school_id         BINARY(16) NOT NULL,
    watched_seconds   DOUBLE NOT NULL DEFAULT 0,
    duration_seconds  DOUBLE NULL,
    last_position     DOUBLE NOT NULL DEFAULT 0,
    last_beat_at      DATETIME(6) NULL,
    completed_at      DATETIME(6) NULL,
    PRIMARY KEY (material_id, student_id),
    CONSTRAINT lvp_material_fk FOREIGN KEY (material_id) REFERENCES lms_materials (id) ON DELETE CASCADE,
    CONSTRAINT lvp_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT lvp_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
