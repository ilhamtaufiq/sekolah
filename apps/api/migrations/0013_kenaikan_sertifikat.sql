-- Kenaikan kelas, kelulusan, dan sertifikat bernomor.
-- Tabel students tidak diubah: status 'lulus' sudah ada sejak 0002.

-- Riwayat keputusan kenaikan. Satu siswa hanya punya satu keputusan per tahun ajaran asal.
CREATE TABLE student_promotions (
    id                 BINARY(16) NOT NULL PRIMARY KEY,
    school_id          BINARY(16) NOT NULL,
    academic_year_id   BINARY(16) NOT NULL,
    student_id         BINARY(16) NOT NULL,
    from_class_id      BINARY(16) NOT NULL,
    decision           VARCHAR(10) NOT NULL,
    to_class_id        BINARY(16) NULL,
    processed_at       DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    processed_by       BINARY(16) NOT NULL,
    UNIQUE KEY promotions_year_student_uq (academic_year_id, student_id),
    INDEX promotions_school_idx (school_id, processed_at),
    CONSTRAINT promotions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT promotions_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT promotions_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT promotions_from_class_fk FOREIGN KEY (from_class_id) REFERENCES classes (id),
    CONSTRAINT promotions_to_class_fk FOREIGN KEY (to_class_id) REFERENCES classes (id),
    CONSTRAINT promotions_processor_fk FOREIGN KEY (processed_by) REFERENCES users (id),
    CONSTRAINT promotions_decision_check CHECK (decision IN ('naik', 'tinggal', 'lulus')),
    CONSTRAINT promotions_target_check CHECK (
        (decision = 'lulus' AND to_class_id IS NULL) OR (decision <> 'lulus' AND to_class_id IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Sertifikat kelulusan. Nomor dibentuk {seq}/{kode}/{tahun} dan unik per sekolah.
-- Satu siswa hanya punya satu sertifikat per sekolah, jadi nomornya tidak pernah berubah.
CREATE TABLE certificates (
    id                 BINARY(16) NOT NULL PRIMARY KEY,
    school_id          BINARY(16) NOT NULL,
    student_id         BINARY(16) NOT NULL,
    academic_year_id   BINARY(16) NOT NULL,
    nomor              VARCHAR(60) NOT NULL,
    tahun              SMALLINT UNSIGNED NOT NULL,
    seq                INT UNSIGNED NOT NULL,
    issued_at          DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    issued_by          BINARY(16) NOT NULL,
    UNIQUE KEY certificates_school_nomor_uq (school_id, nomor),
    UNIQUE KEY certificates_school_student_uq (school_id, student_id),
    UNIQUE KEY certificates_school_seq_uq (school_id, tahun, seq),
    CONSTRAINT certificates_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT certificates_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT certificates_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT certificates_issuer_fk FOREIGN KEY (issued_by) REFERENCES users (id),
    CONSTRAINT certificates_seq_check CHECK (seq >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
