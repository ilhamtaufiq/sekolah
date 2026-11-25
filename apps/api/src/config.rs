use anyhow::{Context, Result, bail};

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_ttl_hours: i64,
    pub bind_addr: String,
    pub run_migrations: bool,
    /// Folder lampiran LMS. Berkas tidak pernah disajikan sebagai static file.
    pub upload_dir: std::path::PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL wajib diisi")?;
        let jwt_secret = std::env::var("JWT_SECRET").context("JWT_SECRET wajib diisi")?;
        if jwt_secret.len() < 32 {
            bail!("JWT_SECRET minimal 32 karakter");
        }

        Ok(Self {
            database_url,
            jwt_secret,
            jwt_ttl_hours: env_or("JWT_TTL_HOURS", "8")
                .parse()
                .context("JWT_TTL_HOURS harus angka")?,
            bind_addr: env_or("BIND_ADDR", "0.0.0.0:8080"),
            run_migrations: env_or("RUN_MIGRATIONS", "true") == "true",
            upload_dir: std::path::PathBuf::from(env_or("UPLOAD_DIR", "./uploads")),
        })
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}
