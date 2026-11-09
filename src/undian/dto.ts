import { z } from 'zod';

const contact = z.string().trim().max(80).optional().default('');

export const participantInput = z.object({
  name: z.string().trim().min(1).max(60),
  contact,
  /** number of entries; more tickets = proportionally more chances */
  tickets: z.number().int().min(1).max(100).optional().default(1),
});

export const prizeInput = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(100).optional().default(1),
});

const uniqueNames = <T extends { name: string }>(list: T[]) =>
  new Set(list.map((x) => x.name.toLowerCase())).size === list.length;

export const createUndianSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(''),
  allowMultipleWins: z.boolean().optional().default(false),
  ticketPrefix: z
    .string()
    .trim()
    .regex(/^[A-Z]{1,5}$/, '1–5 capital letters, e.g. T or DP')
    .optional()
    .default('T'),
  /** in draw order — the first prize in the list is drawn first */
  prizes: z.array(prizeInput).max(50).optional().default([]),
  participants: z
    .array(participantInput)
    .max(2000)
    .optional()
    .default([])
    .refine(uniqueNames, { message: 'participant names must be unique' }),
});

export const drawSchema = z.object({
  publicEntropy: z
    .string()
    .trim()
    .min(3, 'ask the audience for some public randomness, e.g. numbers they shout')
    .max(200),
});

export type CreateUndianDto = z.infer<typeof createUndianSchema>;
export type ParticipantDto = z.infer<typeof participantInput>;
export type PrizeDto = z.infer<typeof prizeInput>;
export type DrawDto = z.infer<typeof drawSchema>;
