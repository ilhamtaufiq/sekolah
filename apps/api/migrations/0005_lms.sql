-- F4: LMS. Ruang kelas = penugasan (mapel × kelas × guru) dari F2.
-- Waktu disimpan UTC (DATETIME(6)). Berkas disimpan di disk; tabel ini hanya metadatanya.

CREATE TABLE lms_materials (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    title          VARCHAR(200) NOT NULL,
    body           TEXT NULL,
    created_by     BINARY(16) NOT NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX lms_materials_room_idx (assignment_id),
    CONSTRAINT lms_materials_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_materials_room_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT lms_materials_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE lms_tasks (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    title          VARCHAR(200) NOT NULL,
    instructions   TEXT NULL,
    due_at         DATETIME(6) NOT NULL,
    max_score      DOUBLE NOT NULL,
    allow_late     BOOLEAN NOT NULL DEFAULT FALSE,
    created_by     BINARY(16) NOT NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX lms_tasks_room_idx (assignment_id),
    CONSTRAINT lms_tasks_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_tasks_room_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT lms_tasks_creator_fk FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT lms_tasks_max_check CHECK (max_score > 0 AND max_score <= 1000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE lms_submissions (
    id            BINARY(16) NOT NULL PRIMARY KEY,
    school_id     BINARY(16) NOT NULL,
    task_id       BINARY(16) NOT NULL,
    student_id    BINARY(16) NOT NULL,
    text_body     TEXT NULL,
    submitted_at  DATETIME(6) NOT NULL,
    is_late       BOOLEAN NOT NULL DEFAULT FALSE,
    score         DOUBLE NULL,
    feedback      TEXT NULL,
    graded_at     DATETIME(6) NULL,
    graded_by     BINARY(16) NULL,
    UNIQUE KEY lms_submissions_task_student_uq (task_id, student_id),
    CONSTRAINT lms_submissions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_submissions_task_fk FOREIGN KEY (task_id) REFERENCES lms_tasks (id) ON DELETE CASCADE,
    CONSTRAINT lms_submissions_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT lms_submissions_grader_fk FOREIGN KEY (graded_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT lms_submissions_score_check CHECK (score IS NULL OR score >= 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Berkas untuk materi maupun pengumpulan. owner_id bersifat polimorfik, jadi penghapusan
-- dikelola aplikasi (berkas di disk ikut dihapus).
CREATE TABLE lms_files (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    school_id    BINARY(16) NOT NULL,
    owner_kind   VARCHAR(12) NOT NULL,
    owner_id     BINARY(16) NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    stored_name  VARCHAR(64) NOT NULL,
    mime         VARCHAR(100) NOT NULL,
    size_bytes   BIGINT UNSIGNED NOT NULL,
    uploaded_by  BINARY(16) NOT NULL,
    created_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY lms_files_stored_uq (stored_name),
    INDEX lms_files_owner_idx (owner_kind, owner_id),
    CONSTRAINT lms_files_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_files_uploader_fk FOREIGN KEY (uploaded_by) REFERENCES users (id),
    CONSTRAINT lms_files_kind_check CHECK (owner_kind IN ('material', 'submission'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE lms_announcements (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    title          VARCHAR(200) NOT NULL,
    body           TEXT NOT NULL,
    created_by     BINARY(16) NOT NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX lms_announcements_room_idx (assignment_id),
    CONSTRAINT lms_announcements_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_announcements_room_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT lms_announcements_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
