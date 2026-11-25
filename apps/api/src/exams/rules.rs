//! Aturan murni ujian: waktu, penilaian, dan analisis butir soal.
//! Tidak menyentuh database supaya bisa diuji unit.

use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

/// Batas waktu percobaan: durasi dari saat mulai, tetapi tidak melewati akhir jendela ujian.
pub fn deadline_for(
    started: DateTime<Utc>,
    duration_minutes: u32,
    window_end: DateTime<Utc>,
) -> DateTime<Utc> {
    (started + Duration::minutes(i64::from(duration_minutes))).min(window_end)
}

/// Jendela ujian berlaku untuk mulai: start <= now < end.
pub fn in_window(now: DateTime<Utc>, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
    now >= start && now < end
}

/// Jawaban (termasuk submit) masih diterima sampai deadline + grace. Grace hanya untuk jaringan lambat.
pub fn accepts_answers(now: DateTime<Utc>, deadline: DateTime<Utc>, grace_seconds: u32) -> bool {
    now <= deadline + Duration::seconds(i64::from(grace_seconds))
}

/// Skor pilihan ganda: poin penuh bila jawaban sama dengan kunci (tanpa membedakan huruf besar).
pub fn pg_points(answer: Option<&str>, key: &str, points: u32) -> u32 {
    match answer.map(str::trim) {
        Some(a) if !a.is_empty() && a.eq_ignore_ascii_case(key) => points,
        _ => 0,
    }
}

/// Hasil satu percobaan untuk analisis: total skor dan benar/salahnya tiap soal PG.
pub struct AttemptResult {
    pub total: i64,
    pub correct: HashMap<Uuid, bool>,
}

#[derive(Debug, PartialEq)]
pub struct ItemStat {
    pub question_id: Uuid,
    pub attempts: usize,
    /// Tingkat kesukaran: proporsi percobaan yang menjawab benar (0–1).
    pub difficulty: Option<f64>,
    /// Daya beda: p(kelompok atas) − p(kelompok bawah), masing-masing 27% percobaan.
    pub discrimination: Option<f64>,
}

/// Kelompok atas/bawah minimal 27% dari percobaan, dan minimal satu orang per kelompok.
/// Di bawah 2 percobaan daya beda tidak bermakna.
fn group_size(n: usize) -> usize {
    ((n as f64) * 0.27).round().max(1.0) as usize
}

pub fn item_analysis(results: &[AttemptResult], questions: &[Uuid]) -> Vec<ItemStat> {
    let n = results.len();
    let mut ordered: Vec<&AttemptResult> = results.iter().collect();
    ordered.sort_by_key(|r| std::cmp::Reverse(r.total));
    let g = group_size(n).min(n / 2);

    questions
        .iter()
        .map(|qid| {
            let answered: Vec<bool> = results
                .iter()
                .filter_map(|r| r.correct.get(qid).copied())
                .collect();
            let difficulty = (!answered.is_empty()).then(|| {
                let correct = answered.iter().filter(|c| **c).count();
                correct as f64 / n as f64
            });

            let discrimination = if n >= 2 && g >= 1 {
                let p = |group: &[&AttemptResult]| -> f64 {
                    let correct = group
                        .iter()
                        .filter(|r| r.correct.get(qid).copied().unwrap_or(false))
                        .count();
                    correct as f64 / group.len() as f64
                };
                let upper = p(&ordered[..g]);
                let lower = p(&ordered[n - g..]);
                Some(((upper - lower) * 1000.0).round() / 1000.0)
            } else {
                None
            };

            ItemStat {
                question_id: *qid,
                attempts: answered.len(),
                difficulty: difficulty.map(|d| (d * 1000.0).round() / 1000.0),
                discrimination,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, h, m, 0).unwrap()
    }

    #[test]
    fn deadline_is_capped_by_window_end() {
        assert_eq!(deadline_for(t(8, 0), 60, t(8, 30)), t(8, 30));
        assert_eq!(deadline_for(t(8, 0), 30, t(9, 0)), t(8, 30));
    }

    #[test]
    fn window_is_half_open() {
        assert!(in_window(t(8, 0), t(8, 0), t(9, 0)));
        assert!(!in_window(t(9, 0), t(8, 0), t(9, 0)));
        assert!(!in_window(t(7, 59), t(8, 0), t(9, 0)));
    }

    #[test]
    fn grace_period_applies_after_deadline() {
        let deadline = t(8, 30);
        assert!(accepts_answers(deadline, deadline, 30));
        assert!(accepts_answers(
            deadline + Duration::seconds(30),
            deadline,
            30
        ));
        assert!(!accepts_answers(
            deadline + Duration::seconds(31),
            deadline,
            30
        ));
    }

    #[test]
    fn pg_scoring_ignores_case_and_blanks() {
        assert_eq!(pg_points(Some("b"), "B", 2), 2);
        assert_eq!(pg_points(Some(" B "), "B", 2), 2);
        assert_eq!(pg_points(Some("A"), "B", 2), 0);
        assert_eq!(pg_points(Some(""), "B", 2), 0);
        assert_eq!(pg_points(None, "B", 2), 0);
    }

    #[test]
    fn item_analysis_computes_difficulty_and_discrimination() {
        let q = Uuid::new_v4();
        // 4 percobaan: dua kelompok atas (benar) dan bawah (salah).
        let mk = |total: i64, ok: bool| AttemptResult {
            total,
            correct: HashMap::from([(q, ok)]),
        };
        let results = vec![mk(10, true), mk(8, true), mk(3, false), mk(1, false)];
        let stats = item_analysis(&results, &[q]);
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].attempts, 4);
        assert_eq!(stats[0].difficulty, Some(0.5));
        // g = round(4*0.27) = 1 → upper 1.0 − lower 0.0 = 1.0
        assert_eq!(stats[0].discrimination, Some(1.0));
    }

    #[test]
    fn item_analysis_without_enough_attempts_has_no_discrimination() {
        let q = Uuid::new_v4();
        let results = vec![AttemptResult {
            total: 5,
            correct: HashMap::from([(q, true)]),
        }];
        let stats = item_analysis(&results, &[q]);
        assert_eq!(stats[0].discrimination, None);
        assert_eq!(stats[0].difficulty, Some(1.0));
    }

    #[test]
    fn item_analysis_empty_question_has_no_difficulty() {
        let q = Uuid::new_v4();
        let stats = item_analysis(&[], &[q]);
        assert_eq!(stats[0].difficulty, None);
        assert_eq!(stats[0].attempts, 0);
    }
}
