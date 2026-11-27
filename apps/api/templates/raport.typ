// Template raport. Data dibaca dari data.json yang disediakan renderer.
// Font: daftar fallback dipakai bila font yang diminta tidak tersedia di server.
#let d = json("data.json")
#let fam = (d.page.font_family, "Liberation Serif", "Libertinus Serif")

#set page(width: d.page.width_mm * 1mm, height: d.page.height_mm * 1mm, margin: d.page.margin_mm * 1mm)
#set text(font: fam, size: d.page.font_size_pt * 1pt, lang: "id")

#align(center)[
  #text(size: 1.2em, weight: "bold")[#upper(d.kop.title)] \
  #if d.kop.subtitle != none [#d.kop.subtitle \ ]
  #text(size: 0.9em)[#d.kop.address]
]
#line(length: 100%, stroke: 1.2pt)
#v(0.5em)
#align(center)[#text(weight: "bold")[LAPORAN HASIL BELAJAR]]
#v(0.5em)

#table(
  columns: (auto, 1fr), stroke: none, inset: (x: 0pt, y: 2pt),
  [Nama], [: #d.student.name],
  [NIS], [: #d.student.nis],
  [Kelas], [: #d.student.class_name],
  [Semester], [: #d.student.semester_name #d.student.academic_year],
)
#v(0.6em)

#for kind in d.sections {
  if kind == "nilai_akademik" [
    #text(weight: "bold")[A. Nilai akademik]
    #v(0.2em)
    #table(
      columns: (1fr, auto, auto, auto), align: (left, center, center, left), inset: 4pt,
      table.header([*Mata pelajaran*], [*Nilai*], [*Predikat*], [*Ketuntasan*]),
      ..d.grades.map(g => (g.subject, g.score, g.predicate, g.kkm)).flatten(),
    )
    #v(0.6em)
  ] else if kind == "sikap" [
    #text(weight: "bold")[B. Sikap dan perilaku]
    #v(0.2em)
    #let sikap = d.at("sikap", default: ())
    #for s in sikap [
      #s.aspect: predikat #s.predicate#if s.description != none [ (#s.description)] \
    ]
    #if d.notes.attitude != none [#d.notes.attitude] else if sikap.len() == 0 [-]
    #v(0.6em)
  ] else if kind == "ekstrakurikuler" [
    #text(weight: "bold")[C. Ekstrakurikuler]
    #v(0.2em)
    #let ekskul = d.at("ekstrakurikuler_items", default: ())
    #for e in ekskul [
      #e.name: predikat #e.predicate#if e.description != none [ (#e.description)] \
    ]
    #if d.notes.extracurricular != none [#d.notes.extracurricular] else if ekskul.len() == 0 [-]
    #v(0.6em)
  ] else if kind == "absensi" [
    #text(weight: "bold")[D. Ketidakhadiran]
    #v(0.2em)
    Sakit: #d.absences.sakit hari, Izin: #d.absences.izin hari, Alpa: #d.absences.alpa hari
    #v(0.6em)
  ] else if kind == "ranking" [
    #if d.rank != none [
      #text(weight: "bold")[E. Peringkat]
      #v(0.2em)
      Peringkat #d.rank.position dari #d.rank.total siswa (rata-rata #d.rank.average)
      #v(0.6em)
    ]
  ] else if kind == "catatan_wali_kelas" [
    #text(weight: "bold")[F. Catatan wali kelas]
    #v(0.2em)
    #if d.notes.homeroom != none [#d.notes.homeroom] else [-]
    #v(0.6em)
  ] else if kind == "ketuntasan_tujuan" [
    #let m = d.at("mastery", default: (tuntas: 0, belum_tuntas: 0, total: 0, mapel_belum: ()))
    #text(weight: "bold")[Ketuntasan tujuan pembelajaran]
    #v(0.2em)
    #if m.total == 0 [
      Belum ada nilai akhir mapel.
    ] else [
      #m.tuntas dari #m.total mapel tuntas KKM.
      #if m.belum_tuntas > 0 [ Belum tuntas: #m.mapel_belum.join(", ")]
    ]
    #v(0.6em)
  ]
}

#text(size: 0.85em)[
  Keterangan predikat:
  #d.predicates.map(p => [#p.label (#p.min ke atas) #p.description]).join("; ")
]

#v(1.2em)
#grid(
  columns: (1fr, 1fr), align: center,
  [Mengetahui, \ Kepala Sekolah \ #v(2.5em) *#d.signatures.kepala_name* \ #if d.signatures.kepala_nip != none [NIP. #d.signatures.kepala_nip] else []],
  [#d.signatures.city, #d.signatures.date \ #d.signatures.wali_title \ #v(2.5em) *#d.signatures.wali_name*],
)
