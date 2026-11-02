import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

if (!process.env.DATABASE_URL) throw new Error('运行迁移需要 DATABASE_URL')
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const client = await pool.connect()
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS quexin; CREATE TABLE IF NOT EXISTS quexin.schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
  const directory = resolve('server/migrations')
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()
  for (const name of files) {
    const exists = await client.query(`SELECT 1 FROM quexin.schema_migrations WHERE name=$1`, [name])
    if (exists.rowCount) continue
    await client.query('BEGIN')
    try {
      await client.query(await readFile(resolve(directory, name), 'utf8'))
      await client.query(`INSERT INTO quexin.schema_migrations(name) VALUES($1)`, [name])
      await client.query('COMMIT')
      console.log(`已应用迁移：${name}`)
    } catch (error) { await client.query('ROLLBACK'); throw error }
  }
  const appRole=process.env.DATABASE_APP_ROLE
  if(appRole){
    if(!/^[a-z_][a-z0-9_]*$/i.test(appRole))throw new Error('DATABASE_APP_ROLE 只能包含字母、数字和下划线')
    await client.query(`GRANT USAGE ON SCHEMA quexin TO ${appRole}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA quexin TO ${appRole}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA quexin TO ${appRole}`)
    await client.query(`REVOKE ALL ON quexin.maintenance_runs,quexin.system_alerts,quexin.notification_jobs FROM ${appRole}`)
    await client.query(`GRANT SELECT(id,started_at,completed_at,status,expired_exports,deleted_spaces,removed_media,expired_sessions,expired_tokens) ON quexin.maintenance_runs TO ${appRole}`)
    await client.query(`GRANT SELECT(id,severity,source,code,message,created_at,resolved_at) ON quexin.system_alerts TO ${appRole}`)
    await client.query(`GRANT INSERT ON quexin.notification_jobs TO ${appRole}`)
    await client.query(`GRANT SELECT(id,recipient,kind,status,attempts,next_attempt_at,last_error,created_at,sent_at,last_attempt_at,provider,provider_message_id,accepted,rejected) ON quexin.notification_jobs TO ${appRole}`)
    await client.query(`GRANT EXECUTE ON FUNCTION quexin.end_membership(boolean) TO ${appRole}`)
    await client.query(`GRANT EXECUTE ON FUNCTION quexin.delete_owned_space(uuid) TO ${appRole}`)
    console.log(`已刷新应用角色权限：${appRole}`)
  }
} finally { client.release(); await pool.end() }
