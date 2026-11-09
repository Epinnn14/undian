import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { openApi, ZodPipe } from '../common/zod.pipe';
import {
  CreateGroupDto,
  createGroupSchema,
  DrawDto,
  drawSchema,
  MemberDto,
  memberInput,
  PayContributionDto,
  payContributionSchema,
  StartGroupDto,
  startGroupSchema,
} from './dto';
import { GroupsService } from './groups.service';

@ApiTags('arisan')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an arisan group (optionally with its members)' })
  @ApiBody({ schema: openApi(createGroupSchema) })
  create(@Body(new ZodPipe(createGroupSchema)) dto: CreateGroupDto) {
    return this.groups.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List arisan groups' })
  list() {
    return this.groups.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Group detail with members and rounds (seeds stay hidden)' })
  detail(@Param('id') id: string) {
    return this.groups.detail(id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add a member before the arisan starts' })
  @ApiBody({ schema: openApi(memberInput) })
  addMember(@Param('id') id: string, @Body(new ZodPipe(memberInput)) dto: MemberDto) {
    return this.groups.addMember(id, dto);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start the arisan: opens round 1 and publishes its commitment' })
  @ApiBody({ schema: openApi(startGroupSchema) })
  start(@Param('id') id: string, @Body(new ZodPipe(startGroupSchema)) dto: StartGroupDto) {
    return this.groups.start(id, dto);
  }

  @Get(':id/ledger')
  @ApiOperation({ summary: 'Buku arisan: contributions, payouts and net position per member' })
  ledger(@Param('id') id: string) {
    return this.groups.ledger(id);
  }

  @Get(':id/rounds/:n')
  @ApiParam({ name: 'n', type: Number })
  @ApiOperation({ summary: 'Round status: who paid, who has not, commitment and result' })
  round(@Param('id') id: string, @Param('n', ParseIntPipe) n: number) {
    return this.groups.round(id, n);
  }

  @Post(':id/rounds/:n/contributions')
  @ApiParam({ name: 'n', type: Number })
  @ApiOperation({ summary: "Record a member's contribution for a round" })
  @ApiBody({ schema: openApi(payContributionSchema) })
  pay(
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
    @Body(new ZodPipe(payContributionSchema)) dto: PayContributionDto,
  ) {
    return this.groups.pay(id, n, dto.memberId);
  }

  @Post(':id/rounds/:n/draw')
  @HttpCode(200)
  @ApiParam({ name: 'n', type: Number })
  @ApiOperation({ summary: 'Draw the winner (kocok) and reveal the seed' })
  @ApiBody({ schema: openApi(drawSchema) })
  draw(
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
    @Body(new ZodPipe(drawSchema)) dto: DrawDto,
  ) {
    return this.groups.draw(id, n, dto);
  }

  @Get(':id/rounds/:n/verify')
  @ApiParam({ name: 'n', type: Number })
  @ApiOperation({ summary: 'Independently recompute and verify a past draw' })
  verify(@Param('id') id: string, @Param('n', ParseIntPipe) n: number) {
    return this.groups.verify(id, n);
  }
}
