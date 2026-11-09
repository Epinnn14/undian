import { Body, Controller, Get, Header, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { openApi, ZodPipe } from '../common/zod.pipe';
import {
  CreateUndianDto,
  createUndianSchema,
  DrawDto,
  drawSchema,
  ParticipantDto,
  PrizeDto,
  participantInput,
  prizeInput,
} from './dto';
import { UndianService } from './undian.service';

@ApiTags('undian')
@Controller('undian')
export class UndianController {
  constructor(private readonly undian: UndianService) {}

  @Post()
  @ApiOperation({ summary: 'Create an undian (optionally with prizes and participants)' })
  @ApiBody({ schema: openApi(createUndianSchema) })
  create(@Body(new ZodPipe(createUndianSchema)) dto: CreateUndianDto) {
    return this.undian.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List undian' })
  list() {
    return this.undian.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail: prizes, participants with ticket codes, draw slots' })
  detail(@Param('id') id: string) {
    return this.undian.detail(id);
  }

  @Post(':id/participants')
  @ApiOperation({ summary: 'Register a participant (and their tickets) while in draft' })
  @ApiBody({ schema: openApi(participantInput) })
  addParticipant(
    @Param('id') id: string,
    @Body(new ZodPipe(participantInput)) dto: ParticipantDto,
  ) {
    return this.undian.addParticipant(id, dto);
  }

  @Post(':id/prizes')
  @ApiOperation({ summary: 'Add a prize while in draft; prizes are drawn in the order added' })
  @ApiBody({ schema: openApi(prizeInput) })
  addPrize(@Param('id') id: string, @Body(new ZodPipe(prizeInput)) dto: PrizeDto) {
    return this.undian.addPrize(id, dto);
  }

  @Post(':id/lock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close registration and publish a commitment for every draw slot' })
  lock(@Param('id') id: string) {
    return this.undian.lock(id);
  }

  @Post(':id/draw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Draw the next slot (kocok) and reveal its seed' })
  @ApiBody({ schema: openApi(drawSchema) })
  draw(@Param('id') id: string, @Body(new ZodPipe(drawSchema)) dto: DrawDto) {
    return this.undian.drawNext(id, dto);
  }

  @Get(':id/draws/:slot')
  @ApiParam({ name: 'slot', type: Number })
  @ApiOperation({ summary: 'One draw slot: prize, commitment, and the result once drawn' })
  getDraw(@Param('id') id: string, @Param('slot', ParseIntPipe) slot: number) {
    return this.undian.getDraw(id, slot);
  }

  @Get(':id/draws/:slot/verify')
  @ApiParam({ name: 'slot', type: Number })
  @ApiOperation({ summary: 'Independently recompute and verify a past draw' })
  verify(@Param('id') id: string, @Param('slot', ParseIntPipe) slot: number) {
    return this.undian.verify(id, slot);
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Winners per prize, in draw order' })
  results(@Param('id') id: string) {
    return this.undian.results(id);
  }

  @Get(':id/results.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Winners as CSV, including seeds and entropy for re-verification' })
  resultsCsv(@Param('id') id: string) {
    return this.undian.resultsCsv(id);
  }

  @Get(':id/tickets/:code')
  @ApiOperation({ summary: 'Cek nomor undian: owner of a ticket and whether it won' })
  ticket(@Param('id') id: string, @Param('code') code: string) {
    return this.undian.ticket(id, code);
  }
}
