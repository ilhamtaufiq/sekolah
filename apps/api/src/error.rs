use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

/// Satu masalah pada satu field, dipakai untuk respons validasi.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FieldIssue {
    pub field: String,
    pub message: String,
}

impl FieldIssue {
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("tidak terautentikasi")]
    Unauthorized,
    #[error("tidak diizinkan")]
    Forbidden,
    #[error("data tidak ditemukan")]
    NotFound,
    #[error("konflik: {0}")]
    Conflict(String),
    #[error("validasi gagal")]
    Validation(Vec<FieldIssue>),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl AppError {
    /// Memetakan error database ke respons yang bermakna.
    /// 1062 = duplikat (unique key). 1451/1452 = data terikat relasi lain (FK).
    /// Nomor error MySQL dibaca langsung; kode SQLSTATE (23000) terlalu umum.
    pub fn from_db(err: sqlx::Error, conflict: &str) -> Self {
        if let sqlx::Error::Database(db) = &err
            && let Some(mysql) = db.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
        {
            match mysql.number() {
                1062 => return AppError::Conflict(conflict.to_string()),
                1451 | 1452 => {
                    return AppError::Conflict(format!(
                        "{conflict} (data masih dipakai atau tidak valid)"
                    ));
                }
                _ => {}
            }
        }
        AppError::Internal(err.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, details) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", Vec::new()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", Vec::new()),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found", Vec::new()),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "conflict", Vec::new()),
            AppError::Validation(issues) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_failed",
                issues.clone(),
            ),
            AppError::Internal(err) => {
                tracing::error!(error = ?err, "kesalahan internal");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", Vec::new())
            }
        };

        let message = match &self {
            AppError::Internal(_) => "terjadi kesalahan internal".to_string(),
            other => other.to_string(),
        };

        (
            status,
            Json(json!({ "error": code, "message": message, "details": details })),
        )
            .into_response()
    }
}
