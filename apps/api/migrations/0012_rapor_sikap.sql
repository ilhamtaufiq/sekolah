-- Rapor: sikap (spiritual dan sosial), ekstrakurikuler, dan ketuntasan tujuan.
-- Ketuntasan tidak butuh tabel baru: memakai final_grades.kkm_met yang sudah ada.

-- Master kegiatan ekstrakurikuler per sekolah.
CREATE TABLE extracurricular_activities (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    name        VARCHAR(100) NOT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY extra_activities_name_uq (school_id, name),
    CONSTRAINT extra_activities_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Sikap per aspek per siswa per semester. Predikat A sampai D.
CREATE TABLE term_attitudes (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    school_id    BINARY(16) NOT NULL,
    semester_id  BINARY(16) NOT NULL,
    student_id   BINARY(16) NOT NULL,
    aspect       VARCHAR(10) NOT NULL,
    predicate    CHAR(1) NOT NULL,
    description  TEXT NULL,
    updated_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY term_attitudes_uq (semester_id, student_id, aspect),
    CONSTRAINT term_attitudes_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT term_attitudes_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT term_attitudes_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT term_attitudes_aspect_check CHECK (aspect IN ('spiritual', 'sosial')),
    CONSTRAINT term_attitudes_predicate_check CHECK (predicate IN ('A', 'B', 'C', 'D'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ekstrakurikuler per siswa per semester. Satu siswa bisa mengikuti beberapa kegiatan.
CREATE TABLE term_extracurriculars (
    id           BINARY(16) NOT NULL PRIMARY KEY,
    school_id    BINARY(16) NOT NULL,
    semester_id  BINARY(16) NOT NULL,
    student_id   BINARY(16) NOT NULL,
    activity_id  BINARY(16) NOT NULL,
    predicate    CHAR(1) NOT NULL,
    description  TEXT NULL,
    updated_at   DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY term_extra_uq (semester_id, student_id, activity_id),
    CONSTRAINT term_extra_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT term_extra_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters (id),
    CONSTRAINT term_extra_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT term_extra_activity_fk FOREIGN KEY (activity_id) REFERENCES extracurricular_activities (id),
    CONSTRAINT term_extra_predicate_check CHECK (predicate IN ('A', 'B', 'C', 'D'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
