import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configure } from './bootstrap';

async function main() {
  process.env.PGLITE_DIR ??= './data/pglite';
  const app = configure(await NestFactory.create(AppModule));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Undian API on http://localhost:${port} — docs at /docs`, 'Bootstrap');
}

void main();
