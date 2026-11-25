//! Perintah administrasi lewat CLI, dijalankan di container:
//!   simas-api create-school --slug sdn-1 --name "SD Negeri 1"
//!   simas-api create-user --school sdn-1 --email admin@sdn1.sch.id --name "Admin" --password "..." [--role guru]

use anyhow::{Context, Result, anyhow, bail};
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::auth::{Role, hash_password};

pub async fn create_school(pool: &MySqlPool, args: &[String]) -> Result<()> {
    let slug = flag(args, "--slug")?.trim().to_lowercase();
    let name = flag(args, "--name")?.trim().to_string();

    if !(slug.len() >= 3
        && slug.len() <= 40
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
    {
        bail!("slug harus 3–40 karakter: huruf kecil, angka, atau '-'");
    }

    sqlx::query("INSERT INTO schools (id, slug, name) VALUES (?, ?, ?)")
        .bind(Uuid::new_v4())
        .bind(&slug)
        .bind(&name)
        .execute(pool)
        .await
        .context("gagal membuat sekolah (mungkin slug sudah dipakai)")?;

    println!("sekolah '{name}' dibuat dengan slug '{slug}'");
    Ok(())
}

pub async fn create_user(pool: &MySqlPool, args: &[String]) -> Result<()> {
    let slug = flag(args, "--school")?.trim().to_lowercase();
    let email = flag(args, "--email")?.trim().to_lowercase();
    let name = flag(args, "--name")?.trim().to_string();
    let password = flag(args, "--password")?;
    let role = flag(args, "--role").unwrap_or_else(|_| "admin".to_string());

    let role = Role::parse(&role).with_context(|| format!("role '{role}' tidak dikenal"))?;

    if password.chars().count() < 8 {
        bail!("password minimal 8 karakter");
    }

    let school_id: Uuid = sqlx::query_scalar("SELECT id FROM schools WHERE slug = ?")
        .bind(&slug)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow!("sekolah dengan slug '{slug}' tidak ditemukan"))?;

    let hash = hash_password(&password)?;
    sqlx::query(
        "INSERT INTO users (id, school_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(school_id)
    .bind(&email)
    .bind(&name)
    .bind(&hash)
    .bind(role.as_str())
    .execute(pool)
    .await
    .context("gagal membuat user (mungkin email sudah terdaftar)")?;

    println!(
        "user '{email}' ({}) dibuat untuk sekolah '{slug}'",
        role.as_str()
    );
    Ok(())
}

fn flag(args: &[String], name: &str) -> Result<String> {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
        .with_context(|| format!("flag {name} wajib diisi"))
}
