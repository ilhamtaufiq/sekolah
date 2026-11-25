-- 1) Token ujian disimpan sebagai hash argon2, bukan teks biasa.
--    Token lama tidak bisa di-hash ulang di SQL. Paket yang punya token ditandai '!reset':
--    siswa ditolak sampai guru mengatur token baru, supaya paket tidak terbuka diam-diam.
ALTER TABLE exams ADD COLUMN token_hash VARCHAR(255) NULL;
UPDATE exams SET token_hash = '!reset' WHERE token IS NOT NULL;
ALTER TABLE exams DROP COLUMN token;

-- 2) Percobaan token salah, untuk membatasi tebak-tebakan per siswa per paket.
CREATE TABLE exam_token_failures (
    id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    exam_id     BINARY(16) NOT NULL,
    student_id  BINARY(16) NOT NULL,
    failed_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX exam_token_failures_idx (exam_id, student_id, failed_at),
    CONSTRAINT etf_exam_fk FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT etf_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- 3) Tugas LMS bisa terhubung ke komponen nilai F3 (opsional).
ALTER TABLE lms_tasks
    ADD COLUMN grade_component_id BINARY(16) NULL,
    ADD CONSTRAINT lms_tasks_component_fk FOREIGN KEY (grade_component_id)
        REFERENCES grade_components (id) ON DELETE SET NULL;
ALTER TABLE exam_attempts ADD COLUMN locked_at DATETIME(6) NULL;  -- kunci karena keluar dari halaman ujian
