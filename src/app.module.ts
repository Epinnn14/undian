import { Controller, Get, Module } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DatabaseModule } from './db/database.module';
import { GroupsModule } from './groups/groups.module';

@ApiExcludeController()
@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

@Module({ imports: [DatabaseModule, GroupsModule], controllers: [HealthController] })
export class AppModule {}
