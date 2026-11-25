//! Logika hitung nilai. Murni (tanpa database) supaya bisa diuji unit.

use crate::report_format::model::{Grading, Predicate};

/// Nilai akhir = Σ(bobot × skor) / Σ bobot, lalu dibulatkan sesuai desimal format.
/// `None` bila tidak ada komponen atau total bobot nol.
pub fn weighted_score(parts: &[(f64, f64)], decimals: u8) -> Option<f64> {
    let total_weight: f64 = parts.iter().map(|(w, _)| w).sum();
    if parts.is_empty() || total_weight <= 0.0 {
        return None;
    }
    let weighted: f64 = parts.iter().map(|(w, s)| w * s).sum();
    Some(round_to(weighted / total_weight, decimals))
}

pub fn round_to(value: f64, decimals: u8) -> f64 {
    let factor = 10f64.powi(i32::from(decimals));
    (value * factor).round() / factor
}

/// Predikat pertama (dari batas tertinggi) yang batas bawahnya <= nilai.
pub fn predicate_for(score: f64, grading: &Grading) -> Option<&Predicate> {
    let mut sorted: Vec<&Predicate> = grading.predicates.iter().collect();
    sorted.sort_by(|a, b| {
        b.min
            .partial_cmp(&a.min)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sorted.into_iter().find(|p| score >= p.min)
}

pub fn kkm_met(score: f64, grading: &Grading) -> bool {
    score >= grading.kkm
}

/// Skor valid bila berada dalam rentang nilai format aktif.
pub fn in_range(score: f64, grading: &Grading) -> bool {
    score.is_finite() && score >= grading.min_score && score <= grading.max_score
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report_format::ReportFormat;

    fn grading() -> Grading {
        ReportFormat::default().grading
    }

    #[test]
    fn weighted_average_uses_weights() {
        // tugas 30%, uts 30%, uas 40%: (30*80 + 30*70 + 40*90) / 100 = 81
        let got = weighted_score(&[(30.0, 80.0), (30.0, 70.0), (40.0, 90.0)], 0).unwrap();
        assert_eq!(got, 81.0);
    }

    #[test]
    fn weights_do_not_need_to_sum_to_100() {
        let got = weighted_score(&[(1.0, 80.0), (3.0, 60.0)], 1).unwrap();
        assert_eq!(got, 65.0);
    }

    #[test]
    fn empty_or_zero_weight_has_no_score() {
        assert_eq!(weighted_score(&[], 0), None);
        assert_eq!(weighted_score(&[(0.0, 50.0)], 0), None);
    }

    #[test]
    fn rounding_follows_decimal_places() {
        assert_eq!(round_to(72.456, 0), 72.0);
        assert_eq!(round_to(72.456, 1), 72.5);
        assert_eq!(round_to(72.456, 2), 72.46);
    }

    #[test]
    fn predicate_picks_highest_matching_band() {
        let g = grading(); // A>=90, B>=80, C>=75, D>=0
        assert_eq!(predicate_for(91.0, &g).unwrap().label, "A");
        assert_eq!(predicate_for(80.0, &g).unwrap().label, "B");
        assert_eq!(predicate_for(74.0, &g).unwrap().label, "D");
    }

    #[test]
    fn kkm_is_inclusive() {
        let g = grading(); // kkm 75
        assert!(kkm_met(75.0, &g));
        assert!(!kkm_met(74.9, &g));
    }

    #[test]
    fn range_check_rejects_out_of_bounds_and_nan() {
        let g = grading(); // 0..=100
        assert!(in_range(0.0, &g) && in_range(100.0, &g));
        assert!(!in_range(100.1, &g) && !in_range(-1.0, &g) && !in_range(f64::NAN, &g));
    }
}
