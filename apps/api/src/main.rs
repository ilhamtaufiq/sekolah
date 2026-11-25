mod academic;
mod auth;
mod cli;
mod config;
mod db;
mod error;
mod grades;
mod exams;
mod health;
mod lms;
mod report_format;
mod router;
mod state;
mod validate;

use std::sync::Arc;

use anyhow::{Result, bail};
use tracing_subscriber::EnvFilter;

use crate::{auth::JwtKeys, config::Config, state::AppState};

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "simas_api=info,tower_http=info".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url).await?;

    if cfg.run_migrations {
        db::migrate(&pool).await?;
    }

    match args.first().map(String::as_str) {
        None | Some("serve") => {
            let state = AppState {
                pool,
                keys: Arc::new(JwtKeys::new(&cfg.jwt_secret)?),
                jwt_ttl_hours: cfg.jwt_ttl_hours,
                upload_dir: cfg.upload_dir.clone(),
            };
            serve(&cfg.bind_addr, state).await
        }
        Some("create-school") => cli::create_school(&pool, &args[1..]).await,
        Some("create-user") => cli::create_user(&pool, &args[1..]).await,
        Some(other) => bail!("perintah tidak dikenal: {other}"),
    }
}

async fn serve(bind_addr: &str, state: AppState) -> Result<()> {
    let app = router::build(state);
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "simas-api berjalan");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Menangani Ctrl+C dan SIGTERM (yang dikirim Docker/Coolify saat deploy ulang).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut s) = signal(SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
