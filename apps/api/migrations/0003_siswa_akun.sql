-- Prasyarat F3–F5: akun login untuk siswa. Satu siswa paling banyak satu akun.
ALTER TABLE students
    ADD COLUMN user_id BINARY(16) NULL,
    ADD UNIQUE KEY students_user_uq (user_id),
    ADD CONSTRAINT students_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
