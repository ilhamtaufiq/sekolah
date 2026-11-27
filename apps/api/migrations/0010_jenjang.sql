-- Jenjang dan jenis lembaga.
-- jenis_lembaga menentukan istilah yang tampil di UI (lihat src/school_profile.rs).
-- Data lama otomatis berjenis 'sd'.
ALTER TABLE schools
    ADD COLUMN jenis_lembaga VARCHAR(8) NOT NULL DEFAULT 'sd',
    ADD CONSTRAINT schools_jenis_lembaga_check CHECK (jenis_lembaga IN ('sd', 'smp', 'sma', 'pkbm', 'paud', 'tk'));

-- Program kesetaraan kelas (khusus PKBM). NULL berarti tidak ada program.
ALTER TABLE classes
    ADD COLUMN program VARCHAR(8) NULL,
    ADD CONSTRAINT classes_program_check CHECK (program IS NULL OR program IN ('paket_a', 'paket_b', 'paket_c'));
