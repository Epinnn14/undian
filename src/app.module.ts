import { Controller, Get, Module } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DatabaseModule } from './db/database.module';
import { UndianModule } from './undian/undian.module';

@ApiExcludeController()
@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

@Module({ imports: [DatabaseModule, UndianModule], controllers: [HealthController] })
export class AppModule {}
