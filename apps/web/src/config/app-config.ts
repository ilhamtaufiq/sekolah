import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "SCHID",
  version: packageJson.version,
  copyright: `© ${currentYear}, SCHID.`,
  meta: {
    title: "SCHID — Manajemen Sekolah, PKBM, PAUD & TK",
    description:
      "Satu aplikasi untuk sekolah, PKBM, PAUD, dan TK. Akademik, absensi, jurnal, nilai, raport, pembelajaran daring, dan ujian.",
  },
};
