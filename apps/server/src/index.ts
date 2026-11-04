import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'stopper serveren');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'feil ved stopp');
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: '127.0.0.1', port: config.port });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error('Serveren kunne ikke starte:', error);
  process.exit(1);
});
