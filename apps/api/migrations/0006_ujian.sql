-- F5: bank soal, paket ujian, percobaan, jawaban, dan jejak kejadian.
-- Waktu disimpan UTC (DATETIME(6)). Tabel ini hanya merujuk ke tabel F2 dan akun siswa.

CREATE TABLE questions (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    school_id    BINARY(16) NOT NULL,
    subject_id   BINARY(16) NOT NULL,
    author_id    BINARY(16) NOT NULL,
    kind         VARCHAR(10) NOT NULL,
    body         TEXT NOT NULL,
    options      JSON NULL,
    answer_key   VARCHAR(10) NULL,
    points       INT UNSIGNED NOT NULL DEFAULT 1,
    created_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    updated_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX questions_school_subject_idx (school_id, subject_id),
    CONSTRAINT questions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT questions_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects (id),
    CONSTRAINT questions_author_fk FOREIGN KEY (author_id) REFERENCES users (id),
    CONSTRAINT questions_kind_check CHECK (kind IN ('pg', 'esai')),
    CONSTRAINT questions_points_check CHECK (points BETWEEN 1 AND 100),
    CONSTRAINT questions_shape_check CHECK (
        (kind = 'pg' AND options IS NOT NULL AND answer_key IS NOT NULL)
        OR (kind = 'esai' AND options IS NULL AND answer_key IS NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE exams (
    id                 BINARY(16) NOT NULL PRIMARY KEY,
    school_id          BINARY(16) NOT NULL,
    assignment_id      BINARY(16) NOT NULL,
    title              VARCHAR(200) NOT NULL,
    duration_minutes   SMALLINT UNSIGNED NOT NULL,
    window_start       DATETIME(6) NOT NULL,
    window_end         DATETIME(6) NOT NULL,
    shuffle_questions  BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options    BOOLEAN NOT NULL DEFAULT FALSE,
    token              VARCHAR(20) NULL,
    grace_seconds      SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    status             VARCHAR(10) NOT NULL DEFAULT 'draft',
    created_by         BINARY(16) NOT NULL,
    created_at         DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    published_at       DATETIME(6) NULL,
    INDEX exams_assignment_idx (assignment_id),
    CONSTRAINT exams_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT exams_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id),
    CONSTRAINT exams_creator_fk FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT exams_status_check CHECK (status IN ('draft', 'published')),
    CONSTRAINT exams_duration_check CHECK (duration_minutes BETWEEN 1 AND 600),
    CONSTRAINT exams_window_check CHECK (window_end > window_start)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Salinan poin saat soal dipasang, supaya perubahan bank soal tidak mengubah ujian berjalan.
CREATE TABLE exam_questions (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    exam_id      BINARY(16) NOT NULL,
    question_id  BINARY(16) NOT NULL,
    position     SMALLINT UNSIGNED NOT NULL,
    points       INT UNSIGNED NOT NULL,
    UNIQUE KEY exam_questions_uq (exam_id, question_id),
    UNIQUE KEY exam_questions_pos_uq (exam_id, position),
    CONSTRAINT exam_questions_exam_fk FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT exam_questions_question_fk FOREIGN KEY (question_id) REFERENCES questions (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE exam_attempts (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    exam_id         BINARY(16) NOT NULL,
    student_id      BINARY(16) NOT NULL,
    started_at      DATETIME(6) NOT NULL,
    deadline        DATETIME(6) NOT NULL,
    submitted_at    DATETIME(6) NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'in_progress',
    score           INT UNSIGNED NULL,
    graded          BOOLEAN NOT NULL DEFAULT FALSE,
    question_order  JSON NOT NULL,
    option_order    JSON NOT NULL,
    UNIQUE KEY attempts_exam_student_uq (exam_id, student_id),
    INDEX attempts_school_idx (school_id),
    CONSTRAINT attempts_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT attempts_exam_fk FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT attempts_student_fk FOREIGN KEY (student_id) REFERENCES students (id),
    CONSTRAINT attempts_status_check CHECK (status IN ('in_progress', 'submitted', 'expired'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE attempt_answers (
    attempt_id   BINARY(16) NOT NULL,
    question_id  BINARY(16) NOT NULL,
    answer       TEXT NULL,
    score        INT UNSIGNED NULL,
    updated_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (attempt_id, question_id),
    CONSTRAINT answers_attempt_fk FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE,
    CONSTRAINT answers_question_fk FOREIGN KEY (question_id) REFERENCES questions (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE exam_events (
    id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    attempt_id   BINARY(16) NOT NULL,
    kind         VARCHAR(20) NOT NULL,
    occurred_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX events_attempt_idx (attempt_id),
    CONSTRAINT events_attempt_fk FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE,
    CONSTRAINT events_kind_check CHECK (kind IN ('blur', 'focus', 'hidden', 'visible'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
