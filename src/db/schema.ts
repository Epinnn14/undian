import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * draft     → participants and prizes can still be added
 * locked    → registration closed, one commitment per draw slot is published
 * finished  → every slot has been drawn
 */
export const undianStatus = pgEnum('undian_status', ['draft', 'locked', 'finished']);

export const undian = pgTable('undian', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** when false (default) a participant can win at most one prize */
  allowMultipleWins: boolean('allow_multiple_wins').notNull().default(false),
  /** ticket codes are prefix + zero-padded number, e.g. T0001 */
  ticketPrefix: text('ticket_prefix').notNull().default('T'),
  status: undianStatus('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
});

export const participants = pgTable(
  'participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    undianId: uuid('undian_id')
      .notNull()
      .references(() => undian.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contact: text('contact').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('participant_name_per_undian').on(t.undianId, t.name)],
);

/** One row per entry. A participant with 3 tickets has 3 rows and 3 chances. */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    undianId: uuid('undian_id')
      .notNull()
      .references(() => undian.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    /** human-readable, e.g. T0007 — this is what the draw picks and what people check */
    code: text('code').notNull(),
  },
  (t) => [unique('ticket_code_per_undian').on(t.undianId, t.code)],
);

export const prizes = pgTable(
  'prizes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    undianId: uuid('undian_id')
      .notNull()
      .references(() => undian.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    /** draw order: 1 is drawn first (usually the small prizes, the grand prize last) */
    position: integer('position').notNull(),
  },
  (t) => [
    unique('prize_position_per_undian').on(t.undianId, t.position),
    check('prize_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/** One row per prize unit, created (with its commitment) when the undian is locked. */
export const draws = pgTable(
  'draws',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    undianId: uuid('undian_id')
      .notNull()
      .references(() => undian.id, { onDelete: 'cascade' }),
    prizeId: uuid('prize_id')
      .notNull()
      .references(() => prizes.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    /** sha256(seed), public from the moment the undian is locked */
    commitment: text('commitment').notNull(),
    /** kept secret until this slot is drawn, then revealed */
    seed: text('seed').notNull(),
    publicEntropy: text('public_entropy'),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    drawnAt: timestamp('drawn_at', { withTimezone: true }),
  },
  (t) => [
    unique('draw_slot_per_undian').on(t.undianId, t.slot),
    unique('ticket_wins_once').on(t.ticketId),
  ],
);

export const undianRelations = relations(undian, ({ many }) => ({
  participants: many(participants),
  tickets: many(tickets),
  prizes: many(prizes),
  draws: many(draws),
}));
export const participantsRelations = relations(participants, ({ one, many }) => ({
  undian: one(undian, { fields: [participants.undianId], references: [undian.id] }),
  tickets: many(tickets),
}));
export const ticketsRelations = relations(tickets, ({ one }) => ({
  undian: one(undian, { fields: [tickets.undianId], references: [undian.id] }),
  participant: one(participants, {
    fields: [tickets.participantId],
    references: [participants.id],
  }),
}));
export const prizesRelations = relations(prizes, ({ one, many }) => ({
  undian: one(undian, { fields: [prizes.undianId], references: [undian.id] }),
  draws: many(draws),
}));
export const drawsRelations = relations(draws, ({ one }) => ({
  undian: one(undian, { fields: [draws.undianId], references: [undian.id] }),
  prize: one(prizes, { fields: [draws.prizeId], references: [prizes.id] }),
  ticket: one(tickets, { fields: [draws.ticketId], references: [tickets.id] }),
}));

export type Undian = typeof undian.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Prize = typeof prizes.$inferSelect;
export type Draw = typeof draws.$inferSelect;
