import { z } from 'zod';

const name = z.string().trim().min(1).max(60);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 -]{6,20}$/, 'invalid phone number')
  .optional()
  .default('');

export const memberInput = z.object({ name, phone });

export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    contribution: z.number().int().min(1_000).max(100_000_000),
    frequency: z.enum(['weekly', 'monthly']),
    adminFeePct: z.number().min(0).max(20).multipleOf(0.25).optional().default(0),
    members: z.array(memberInput).max(50).optional().default([]),
  })
  .refine((g) => new Set(g.members.map((m) => m.name.toLowerCase())).size === g.members.length, {
    message: 'member names must be unique',
    path: ['members'],
  });

export const startGroupSchema = z.object({
  startDate: z.iso.date(),
});

export const payContributionSchema = z.object({
  memberId: z.uuid(),
});

export const drawSchema = z.object({
  publicEntropy: z
    .string()
    .trim()
    .min(3, 'ask members for some public randomness, e.g. the numbers they shout')
    .max(200),
});

export type CreateGroupDto = z.infer<typeof createGroupSchema>;
export type MemberDto = z.infer<typeof memberInput>;
export type StartGroupDto = z.infer<typeof startGroupSchema>;
export type PayContributionDto = z.infer<typeof payContributionSchema>;
export type DrawDto = z.infer<typeof drawSchema>;
