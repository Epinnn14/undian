import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configure(app: INestApplication) {
  app.enableShutdownHooks();
  const config = new DocumentBuilder()
    .setTitle('Arisan API')
    .setDescription(
      'Rotating savings groups (arisan) with a verifiable commit–reveal draw. ' +
        'Every round publishes sha256(seed) before anyone pays; the seed is revealed at the draw so the result can be recomputed by anyone.',
    )
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  return app;
}
