import { relations, sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const frequency = pgEnum('frequency', ['weekly', 'monthly']);
export const groupStatus = pgEnum('group_status', ['open', 'running', 'finished']);
export const roundStatus = pgEnum('round_status', ['collecting', 'drawn']);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    contribution: integer('contribution').notNull(),
    frequency: frequency('frequency').notNull(),
    adminFeePct: numeric('admin_fee_pct', { precision: 5, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    status: groupStatus('status').notNull().default('open'),
    startDate: date('start_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('contribution_positive', sql`${t.contribution} > 0`),
    check('fee_range', sql`${t.adminFeePct} >= 0 AND ${t.adminFeePct} <= 20`),
  ],
);

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('member_name_per_group').on(t.groupId, t.name)],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    dueDate: date('due_date').notNull(),
    status: roundStatus('status').notNull().default('collecting'),
    /** sha256(seed), published when the round opens */
    commitment: text('commitment').notNull(),
    /** kept secret until the draw, then revealed */
    seed: text('seed').notNull(),
    publicEntropy: text('public_entropy'),
    winnerId: uuid('winner_id').references(() => members.id),
    payout: integer('payout'),
    fee: integer('fee'),
    drawnAt: timestamp('drawn_at', { withTimezone: true }),
  },
  (t) => [unique('round_number_per_group').on(t.groupId, t.number)],
);

export const contributions = pgTable(
  'contributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    amount: integer('amount').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('one_contribution_per_round').on(t.roundId, t.memberId)],
);

export const groupsRelations = relations(groups, ({ many }) => ({
  members: many(members),
  rounds: many(rounds),
}));
export const membersRelations = relations(members, ({ one }) => ({
  group: one(groups, { fields: [members.groupId], references: [groups.id] }),
}));
export const roundsRelations = relations(rounds, ({ one, many }) => ({
  group: one(groups, { fields: [rounds.groupId], references: [groups.id] }),
  winner: one(members, { fields: [rounds.winnerId], references: [members.id] }),
  contributions: many(contributions),
}));
export const contributionsRelations = relations(contributions, ({ one }) => ({
  round: one(rounds, { fields: [contributions.roundId], references: [rounds.id] }),
  member: one(members, { fields: [contributions.memberId], references: [members.id] }),
}));

export type Group = typeof groups.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Contribution = typeof contributions.$inferSelect;
