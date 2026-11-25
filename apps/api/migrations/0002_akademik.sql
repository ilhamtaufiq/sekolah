-- F2: akademik inti. Semua tabel membawa school_id untuk isolasi tenant.

CREATE TABLE academic_years (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    name        VARCHAR(20) NOT NULL,
    starts_on   DATE NOT NULL,
    ends_on     DATE NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Kolom turunan: bernilai 1 hanya untuk tahun aktif. Dengan unique (school_id, active_key),
    -- satu sekolah hanya bisa punya satu tahun aktif. Tidak memakai school_id karena MySQL
    -- melarang FK ON DELETE CASCADE pada kolom dasar kolom generated.
    active_key  TINYINT AS (IF(is_active, 1, NULL)) STORED,
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY ay_school_name_uq (school_id, name),
    UNIQUE KEY ay_one_active_uq (school_id, active_key),
    CONSTRAINT ay_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT ay_dates_check CHECK (ends_on > starts_on)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE subjects (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    code        VARCHAR(20) NOT NULL,
    name        VARCHAR(120) NOT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY subjects_school_code_uq (school_id, code),
    CONSTRAINT subjects_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE classes (
    id                  BINARY(16) NOT NULL PRIMARY KEY,
    school_id           BINARY(16) NOT NULL,
    academic_year_id    BINARY(16) NOT NULL,
    name                VARCHAR(40) NOT NULL,
    grade_level         TINYINT UNSIGNED NOT NULL,
    homeroom_teacher_id BINARY(16) NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY classes_year_name_uq (academic_year_id, name),
    CONSTRAINT classes_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT classes_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT classes_homeroom_fk FOREIGN KEY (homeroom_teacher_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT classes_grade_check CHECK (grade_level BETWEEN 1 AND 12)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE students (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    school_id   BINARY(16) NOT NULL,
    nis         VARCHAR(20) NOT NULL,
    nisn        VARCHAR(20) NULL,
    name        VARCHAR(200) NOT NULL,
    gender      CHAR(1) NULL,
    birth_date  DATE NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'aktif',
    created_at  DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY students_school_nis_uq (school_id, nis),
    INDEX students_school_name_idx (school_id, name),
    CONSTRAINT students_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT students_gender_check CHECK (gender IN ('L', 'P')),
    CONSTRAINT students_status_check CHECK (status IN ('aktif', 'lulus', 'pindah', 'keluar'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Rombel: satu siswa hanya boleh di satu kelas per tahun ajaran.
CREATE TABLE class_enrollments (
    id                BINARY(16) NOT NULL PRIMARY KEY,
    school_id         BINARY(16) NOT NULL,
    academic_year_id  BINARY(16) NOT NULL,
    class_id          BINARY(16) NOT NULL,
    student_id        BINARY(16) NOT NULL,
    created_at        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY enrollments_year_student_uq (academic_year_id, student_id),
    INDEX enrollments_class_idx (class_id),
    CONSTRAINT enrollments_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT enrollments_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT enrollments_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT enrollments_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Penugasan: satu mapel di satu kelas dipegang satu guru.
CREATE TABLE teaching_assignments (
    id                BINARY(16) NOT NULL PRIMARY KEY,
    school_id         BINARY(16) NOT NULL,
    academic_year_id  BINARY(16) NOT NULL,
    class_id          BINARY(16) NOT NULL,
    subject_id        BINARY(16) NOT NULL,
    teacher_id        BINARY(16) NOT NULL,
    created_at        DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE KEY assignments_class_subject_uq (class_id, subject_id),
    INDEX assignments_teacher_idx (teacher_id),
    CONSTRAINT assignments_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT assignments_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years (id),
    CONSTRAINT assignments_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT assignments_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects (id),
    CONSTRAINT assignments_teacher_fk FOREIGN KEY (teacher_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Jadwal: satu slot mengacu ke satu penugasan. Kelas dan guru didapat dari penugasan.
CREATE TABLE schedule_slots (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    school_id      BINARY(16) NOT NULL,
    assignment_id  BINARY(16) NOT NULL,
    day_of_week    TINYINT UNSIGNED NOT NULL,
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    room           VARCHAR(40) NULL,
    created_at     DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    INDEX schedule_assignment_idx (assignment_id),
    CONSTRAINT schedule_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT schedule_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id) ON DELETE CASCADE,
    CONSTRAINT schedule_day_check CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT schedule_time_check CHECK (end_time > start_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Sesi absensi: 'harian' dicatat wali kelas per kelas, 'mapel' dicatat guru per penugasan.
CREATE TABLE attendance_sessions (
    id              BINARY(16) NOT NULL PRIMARY KEY,
    school_id       BINARY(16) NOT NULL,
    class_id        BINARY(16) NOT NULL,
    assignment_id   BINARY(16) NULL,
    kind            VARCHAR(10) NOT NULL,
    session_date    DATE NOT NULL,
    recorded_by     BINARY(16) NOT NULL,
    created_at      DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    -- Kunci turunan agar sesi harian (assignment NULL) juga bisa dibuat unik.
    assignment_key  BINARY(16) AS (IFNULL(assignment_id, UNHEX(REPEAT('0', 32)))) STORED,
    UNIQUE KEY sessions_unique_uq (class_id, kind, assignment_key, session_date),
    INDEX sessions_school_date_idx (school_id, session_date),
    CONSTRAINT sessions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    CONSTRAINT sessions_class_fk FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE,
    -- RESTRICT: riwayat absensi tidak boleh hilang karena penugasan dihapus.
    CONSTRAINT sessions_assignment_fk FOREIGN KEY (assignment_id) REFERENCES teaching_assignments (id),
    CONSTRAINT sessions_recorder_fk FOREIGN KEY (recorded_by) REFERENCES users (id),
    CONSTRAINT sessions_kind_check CHECK (
        (kind = 'harian' AND assignment_id IS NULL) OR (kind = 'mapel' AND assignment_id IS NOT NULL)),
    CONSTRAINT sessions_kind_value_check CHECK (kind IN ('harian', 'mapel'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE attendance_records (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    session_id  BINARY(16) NOT NULL,
    student_id  BINARY(16) NOT NULL,
    status      CHAR(1) NOT NULL,
    note        VARCHAR(200) NULL,
    UNIQUE KEY records_session_student_uq (session_id, student_id),
    CONSTRAINT records_session_fk FOREIGN KEY (session_id) REFERENCES attendance_sessions (id) ON DELETE CASCADE,
    CONSTRAINT records_student_fk FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT records_status_check CHECK (status IN ('H', 'S', 'I', 'A'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
