import { BUILT_IN_MODELS } from '../config/defaults.js'
import type { ModelSlot } from '../config/types.js'

/**
 * Which model a slot runs on, from the first layer that sets one: a session
 * switch, the user's /config row, the project rules file, the built-in.
 */

export type ModelSource = 'session' | 'settings' | 'project' | 'built-in'

export type ModelChoice = { model: string; source: ModelSource }

export type ModelLayers = {
  session?: string
  /** The /config row's value; `default` means unset. */
  settings?: string
  project?: string
}

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '' && value !== 'default'

export function resolveModel(slot: ModelSlot, layers: ModelLayers): ModelChoice {
  if (isSet(layers.session)) return { model: layers.session, source: 'session' }
  if (isSet(layers.settings)) return { model: layers.settings, source: 'settings' }
  if (isSet(layers.project)) return { model: layers.project, source: 'project' }
  return { model: BUILT_IN_MODELS[slot], source: 'built-in' }
}

/**
 * The request settings that follow from a model, so choosing a model is the
 * only decision. Thinking models spend output tokens thinking, so their cap
 * leaves room; an unknown id is treated as a thinking model.
 */
export type ModelProfile = {
  maxTokens: number
  effort?: 'low'
  deadlineMs: number
}

export function profileOf(model: string): ModelProfile {
  const name = model.toLowerCase()
  if (name.includes('haiku')) return { maxTokens: 400, deadlineMs: 20_000 }
  if (name.includes('sonnet')) return { maxTokens: 2_000, effort: 'low', deadlineMs: 30_000 }
  if (name.includes('fable') || name.includes('mythos')) return { maxTokens: 4_000, effort: 'low', deadlineMs: 90_000 }
  if (name.includes('opus')) return { maxTokens: 2_000, effort: 'low', deadlineMs: 45_000 }
  return { maxTokens: 2_000, effort: 'low', deadlineMs: 45_000 }
}

/** The deadline for one review: the user's override in seconds (0: from the model). */
export const deadlineFor = (model: string, overrideSeconds: number): number =>
  overrideSeconds > 0 ? overrideSeconds * 1000 : profileOf(model).deadlineMs
