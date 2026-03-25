import { shallowRef, computed } from 'vue'
import type { TxPlan } from '~/entities/txPlan'

export type PlanTransformer = (plan: TxPlan) => TxPlan

const guards = shallowRef<Map<string, PlanTransformer>>(new Map())
const blockers = shallowRef<Map<string, string>>(new Map())
const metadata = shallowRef<Map<string, Record<string, unknown>>>(new Map())

export const registerOperationGuard = (key: string, transform: PlanTransformer, meta?: Record<string, unknown>) => {
  const next = new Map(guards.value)
  next.set(key, transform)
  guards.value = next
  if (meta) {
    const nextMeta = new Map(metadata.value)
    nextMeta.set(key, meta)
    metadata.value = nextMeta
  }
}

export const unregisterOperationGuard = (key: string) => {
  const next = new Map(guards.value)
  next.delete(key)
  guards.value = next
  const nextMeta = new Map(metadata.value)
  nextMeta.delete(key)
  metadata.value = nextMeta
}

export const registerOperationBlocker = (key: string, reason: string) => {
  const next = new Map(blockers.value)
  next.set(key, reason)
  blockers.value = next
}

export const unregisterOperationBlocker = (key: string) => {
  const next = new Map(blockers.value)
  next.delete(key)
  blockers.value = next
}

/** Reactive: true when any guard is blocking operations (e.g. keyring verification pending) */
export const isOperationBlocked = computed(() => blockers.value.size > 0)

/** Reactive: reason string from the first active blocker */
export const operationBlockReason = computed(() => {
  const first = blockers.value.values().next()
  return first.done ? undefined : first.value
})

/** Reactive: true when a keyring credential will be injected into the transaction */
export const hasKeyringGuard = computed(() => guards.value.has('keyring'))

/** Reactive: metadata for the keyring guard (includes credentialCost) */
export const keyringGuardMeta = computed(() => metadata.value.get('keyring'))

export const applyOperationGuards = (plan: TxPlan): TxPlan => {
  let result = plan
  for (const transform of guards.value.values()) {
    result = transform(result)
  }
  return result
}
