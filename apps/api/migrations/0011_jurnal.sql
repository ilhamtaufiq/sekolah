-- Jurnal mengajar: catatan per jam pelajaran untuk satu penugasan pada satu tanggal.
-- Alur status: draft -> menunggu -> disetujui | ditolak; ditolak -> menunggu (kirim ulang).
-- Setelah disetujui, jurnal tidak bisa diubah lagi.
CREATE TABLE teaching_journals (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    assignment_id   BINARY(16) NOT NULL,
    teacher_id      BINARY(16) NOT NULL,
    journal_date    DATE NOT NULL,
    hour_no         TINYINT UNSIGNED NOT NULL,
    topic           VARCHAR(200) NOT NULL,
    notes           TEXT NULL,
    present_count   SMALLINT UNSIGNED NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'draft',
    submitted_at    DATETIME(6) NULL,
    decided_by      BINARY(16) NULL,
    decided_at      DATETIME(6) NULL,
    decision_note   TEXT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    updated_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY teaching_journals_slot_uq (assignment_id, journal_date, hour_no),
    INDEX teaching_journals_teacher_idx (teacher_id, journal_date),
    INDEX teaching_journals_school_status_idx (school_id, status, journal_date),
    CONSTRAINT tj_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT tj_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT tj_teacher_fk FOREIGN KEY (teacher_id) REFERENCES users (id),
    CONSTRAINT tj_decided_by_fk FOREIGN KEY (decided_by) REFERENCES users (id),
    CONSTRAINT tj_status_check CHECK (status IN ('draft', 'menunggu', 'disetujui', 'ditolak')),
    CONSTRAINT tj_hour_check CHECK (hour_no BETWEEN 1 AND 20),
    CONSTRAINT tj_decision_check CHECK (
        (status IN ('disetujui', 'ditolak')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
