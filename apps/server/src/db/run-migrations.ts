import { fileURLToPath } from 'url';
import { db } from './index.js';

async function runMigrations() {
  try {
    const [batch, log] = await db.migrate.latest({
      directory: fileURLToPath(new URL('./migrations', import.meta.url)),
      loadExtensions: ['.ts'],
    });
    if (log.length === 0) {
      console.log('Already up to date');
    } else {
      console.log(`Batch ${batch} run: ${log.length} migrations`);
      console.log(log.join('\n'));
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

runMigrations();
