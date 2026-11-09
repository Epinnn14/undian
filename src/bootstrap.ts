import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configure(app: INestApplication) {
  app.enableShutdownHooks();
  const config = new DocumentBuilder()
    .setTitle('Undian API')
    .setDescription(
      'A reusable template for fair draws — doorprize, giveaway, lucky draw, raffle. ' +
        'Locking an undian publishes sha256(seed) for every prize slot; each seed is revealed when its slot is drawn, so anyone can recompute the winner.',
    )
    .setVersion('0.2.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  return app;
}
