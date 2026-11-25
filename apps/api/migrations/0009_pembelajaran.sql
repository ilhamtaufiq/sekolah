-- Pembelajaran: kumpulan materi berurutan (video YouTube atau PDF) dalam satu ruang kelas.
CREATE TABLE lms_lessons (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    title          VARCHAR(200) NOT NULL,
    description    TEXT NULL,
    created_by     BINARY(16) NOT NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX lms_lessons_room_idx (assignment_id),
    CONSTRAINT lms_lessons_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_lessons_room_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT lms_lessons_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE lms_lesson_items (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    lesson_id    BINARY(16) NOT NULL,
    school_id    BINARY(16) NOT NULL,
    position     SMALLINT UNSIGNED NOT NULL,
    kind         VARCHAR(8) NOT NULL,
    material_id  BINARY(16) NOT NULL,
    file_id      BINARY(16) NULL,
    UNIQUE KEY lms_lesson_items_pos_uq (lesson_id, position),
    CONSTRAINT lli_lesson_fk FOREIGN KEY (lesson_id) REFERENCES lms_lessons (id) ON DELETE CASCADE,
    CONSTRAINT lli_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lli_material_fk FOREIGN KEY (material_id) REFERENCES lms_materials (id) ON DELETE CASCADE,
    CONSTRAINT lli_file_fk FOREIGN KEY (file_id) REFERENCES lms_files (id) ON DELETE CASCADE,
    CONSTRAINT lli_kind_check CHECK (kind IN ('video', 'pdf')),
    CONSTRAINT lli_shape_check CHECK ((kind = 'video' AND file_id IS NULL) OR (kind = 'pdf' AND file_id IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Progres PDF per siswa: halaman yang sudah dibuka. Selesai = semua halaman sudah dibuka.
CREATE TABLE lms_pdf_progress (
    file_id      BINARY(16) NOT NULL,
    student_id   BINARY(16) NOT NULL,
    school_id    BINARY(16) NOT NULL,
    total_pages  INT UNSIGNED NOT NULL,
    viewed       JSON NOT NULL,
    completed_at DATETIME(6) NULL,
    updated_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (file_id, student_id),
    CONSTRAINT lpp_file_fk FOREIGN KEY (file_id) REFERENCES lms_files (id) ON DELETE CASCADE,
    CONSTRAINT lpp_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT lpp_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
