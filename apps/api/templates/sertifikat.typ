// Template sertifikat kelulusan. Data dibaca dari data.json yang disediakan renderer.
#let d = json("data.json")

#set page(width: 297mm, height: 210mm, margin: 16mm)
#set text(font: ("Libertinus Serif", "Liberation Serif"), size: 12pt, lang: "id")

#rect(width: 100%, height: 100%, stroke: 2.5pt + rgb("#1e3a5f"), inset: 12mm)[
  #align(center)[
    #text(size: 1.3em, weight: "bold")[#upper(d.kop.title)] \
    #text(size: 0.9em)[#d.kop.address]
  ]
  #v(1fr)
  #align(center)[
    #text(size: 2.4em, weight: "bold")[SERTIFIKAT KELULUSAN] \
    #text(size: 0.95em)[Nomor: #d.nomor]
  ]
  #v(1.2em)
  #align(center)[Dengan ini menyatakan bahwa:]
  #v(0.6em)
  #align(center)[#text(size: 2em, weight: "bold")[#d.student.name]]
  #v(0.4em)
  #align(center)[NIS #d.student.nis, kelas #d.student.class_name]
  #v(0.8em)
  #align(center)[
    telah menyelesaikan pendidikan di #d.school_name dan dinyatakan *LULUS*
    pada tahun ajaran #d.student.academic_year.
  ]
  #v(1fr)
  #grid(
    columns: (1fr, 1fr),
    align: center,
    [],
    [
      #d.city, #d.date_text \
      Kepala Sekolah \
      #v(14mm)
      *#d.kepala_name*
    ],
  )
]
