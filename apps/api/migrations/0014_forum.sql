-- Forum diskusi per materi (ruang kelas yang sama untuk siswa dan guru).
-- Balasan satu tingkat: parent_id menunjuk komentar utama (parent_id-nya sendiri NULL).
-- Batas panjang (1..2000 karakter) ditegakkan aplikasi dan dijaga CHECK di sini.

CREATE TABLE lms_comments (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    material_id     BINARY(16) NOT NULL,
    author_user_id  BINARY(16) NOT NULL,
    parent_id       BINARY(16) NULL,
    body            TEXT NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX lms_comments_material_idx (material_id, created_at),
    INDEX lms_comments_parent_idx (parent_id),
    CONSTRAINT lms_comments_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT lms_comments_material_fk FOREIGN KEY (material_id) REFERENCES lms_materials (id) ON DELETE CASCADE,
    CONSTRAINT lms_comments_author_fk FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT lms_comments_parent_fk FOREIGN KEY (parent_id) REFERENCES lms_comments (id) ON DELETE CASCADE,
    CONSTRAINT lms_comments_body_check CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 2000)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
