import { z } from "zod";
import { goalDecimalSchema, goalIdSchema, goalInstantSchema, goalUnitSchema, goalValueMatchesUnit } from "./goals.ts";

export const MEASUREMENT_NOTE_MAX_LENGTH = 1000;
export const MEASUREMENT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/**
 * `manual`: entered by the person. `example`: from the example the person chose to load (LFS-218), labelled «Пример» and
 * never shown as the person's data; the public API cannot create or edit it.
 */
export const GOAL_MEASUREMENT_SOURCES = Object.freeze(["manual", "example"] as const);
export const goalMeasurementSourceSchema = z.enum(GOAL_MEASUREMENT_SOURCES);
const noteSchema = z.string().trim().min(1).max(MEASUREMENT_NOTE_MAX_LENGTH).nullable();
export const createGoalMeasurementInputSchema = z.strictObject({
  value: goalDecimalSchema,
  measured_at: goalInstantSchema,
  source: z.literal("manual").default("manual"),
  note: noteSchema.default(null),
});
export type CreateGoalMeasurementInput = z.infer<typeof createGoalMeasurementInputSchema>;
export const updateGoalMeasurementInputSchema = z.strictObject({
  value: goalDecimalSchema.optional(), measured_at: goalInstantSchema.optional(), note: noteSchema.optional(),
}).refine((input) => input.value !== undefined || input.measured_at !== undefined || input.note !== undefined, { message: "Nothing to update." });
export type UpdateGoalMeasurementInput = z.infer<typeof updateGoalMeasurementInputSchema>;
export const goalMeasurementSchema = z.strictObject({
  id: goalIdSchema, goal_id: goalIdSchema, user_id: z.string().min(1).max(128), unit: goalUnitSchema,
  value: goalDecimalSchema, measured_at: goalInstantSchema, source: goalMeasurementSourceSchema, note: noteSchema,
  created_at: goalInstantSchema, updated_at: goalInstantSchema,
}).refine((measurement) => goalValueMatchesUnit(measurement.value, measurement.unit), { path: ["value"], message: "Value is not valid for this unit." });
export type GoalMeasurement = z.infer<typeof goalMeasurementSchema>;
export const goalMeasurementDeletionSchema = z.strictObject({
  id: goalIdSchema, goal_id: goalIdSchema, user_id: z.string().min(1).max(128), deleted: z.literal(true),
});
export type GoalMeasurementDeletion = z.infer<typeof goalMeasurementDeletionSchema>;
export const goalMeasurementCurrentSchema = z.strictObject({
  goal_id: goalIdSchema, current: goalDecimalSchema.nullable(), measurement: goalMeasurementSchema.nullable(),
}).refine((result) => result.measurement === null ? result.current === null
  : result.measurement.goal_id === result.goal_id && result.current === result.measurement.value);
export type GoalMeasurementCurrent = z.infer<typeof goalMeasurementCurrentSchema>;
