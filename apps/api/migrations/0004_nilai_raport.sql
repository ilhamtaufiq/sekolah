-- F3: nilai dan raport. Skor disimpan sebagai DOUBLE (bukan DECIMAL) agar tidak perlu fitur decimal di sqlx.

CREATE TABLE semesters (
    id                BINARY(16) NOT NULL PRIMARY KEY,
    school_id         BINARY(16) NOT NULL,
    academic_year_id  BINARY(16) NOT NULL,
    ordinal           TINYINT UNSIGNED NOT NULL,
    name              VARCHAR(40) NOT NULL,
    starts_on         DATE NOT NULL,
    ends_on           DATE NOT NULL,
    created_at        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY semesters_year_ordinal_uq (academic_year_id, ordinal),
    CONSTRAINT semesters_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT semesters_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT semesters_ordinal_check CHECK (ordinal IN (1, 2)),
    CONSTRAINT semesters_dates_check CHECK (ends_on > starts_on)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE grade_components (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    semester_id    BINARY(16) NOT NULL,
    name           VARCHAR(60) NOT NULL,
    weight         DOUBLE NOT NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY components_unique_uq (assignment_id, semester_id, name),
    CONSTRAINT components_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT components_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT components_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT components_weight_check CHECK (weight > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE grade_entries (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    component_id BINARY(16) NOT NULL,
    student_id  BINARY(16) NOT NULL,
    score       DOUBLE NOT NULL,
    note        VARCHAR(200) NULL,
    updated_by  BINARY(16) NULL,
    updated_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY entries_component_student_uq (component_id, student_id),
    CONSTRAINT entries_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT entries_component_fk FOREIGN KEY (component_id) REFERENCES grade_components (id) ON DELETE CASCADE,
    CONSTRAINT entries_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT entries_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Hasil hitung nilai akhir per mapel. Disimpan sebagai snapshot beserta versi format yang dipakai.
CREATE TABLE final_grades (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    assignment_id   BINARY(16) NOT NULL,
    semester_id     BINARY(16) NOT NULL,
    student_id      BINARY(16) NOT NULL,
    score           DOUBLE NULL,
    predicate       VARCHAR(10) NULL,
    kkm_met         BOOLEAN NULL,
    format_version  INT NOT NULL,
    computed_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY finals_unique_uq (assignment_id, semester_id, student_id),
    CONSTRAINT finals_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT finals_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT finals_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT finals_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE student_term_notes (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    class_id        BINARY(16) NOT NULL,
    semester_id     BINARY(16) NOT NULL,
    student_id      BINARY(16) NOT NULL,
    attitude        TEXT NULL,
    extracurricular TEXT NULL,
    homeroom_note   TEXT NULL,
    updated_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY term_notes_unique_uq (semester_id, student_id),
    CONSTRAINT term_notes_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT term_notes_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT term_notes_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT term_notes_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Metadata raport yang sudah dibuat. File PDF disimpan di REPORTS_DIR, bukan di database.
CREATE TABLE report_cards (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    class_id        BINARY(16) NOT NULL,
    semester_id     BINARY(16) NOT NULL,
    student_id      BINARY(16) NOT NULL,
    format_version  INT NOT NULL,
    file_path       VARCHAR(255) NOT NULL,
    generated_by    BINARY(16) NOT NULL,
    generated_at    DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY report_cards_unique_uq (semester_id, student_id),
    CONSTRAINT report_cards_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT report_cards_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT report_cards_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT report_cards_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT report_cards_generated_by_fk FOREIGN KEY (generated_by) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
