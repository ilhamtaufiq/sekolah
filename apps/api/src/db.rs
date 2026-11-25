use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::{MySqlPool, mysql::MySqlPoolOptions};

pub async fn connect(database_url: &str) -> Result<MySqlPool> {
    MySqlPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
        .context("gagal terhubung ke MySQL/MariaDB")
}

/// sqlx mengunci migrasi dengan GET_LOCK, jadi aman bila dua replika start bersamaan.
pub async fn migrate(pool: &MySqlPool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .context("migrasi database gagal")
}
