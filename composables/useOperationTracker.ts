import {
  OperationTracker,
  type TransactionLinker,
} from '@tonappchain/sdk'
import { StageName } from '@tonappchain/sdk/dist/structs/Struct'

const POOL_MS = 5000
const MAX_RETRIES = 40
export const useOperationTracker = (transactionLinker: TransactionLinker | undefined) => {
  let interval: ReturnType<typeof setInterval>
  const { NETWORK } = useAppConfig()
  const tracker = new OperationTracker(NETWORK)
  const operationId = ref('')
  const status = ref('')
  const error = ref('')
  let remainingRetries = MAX_RETRIES

  const destroy = () => {
    clearInterval(interval)
  }

  const pool = async () => {
    remainingRetries--
    if (remainingRetries < 0) {
      error.value = 'Transaction took more time than expected, check execution on TAC Explorer'
      clearInterval(interval)
      return
    }

    if (!operationId.value) {
      operationId.value = await tracker.getOperationId(transactionLinker!).catch(() => '')
    }

    if (operationId.value) {
      const res = await tracker.getOperationStatus(operationId.value)

      if (status.value !== res.stage) {
        remainingRetries = MAX_RETRIES
      }

      status.value = res.stage
      // error.value = res.errorMessage || '' FIXME: setting error breaks pooling now
    }

    if (status.value === StageName.EXECUTED_IN_TON) {
      clearInterval(interval)
    }
  }

  if (!transactionLinker) {
    console.warn('tx linker not found. tracking is not available')
  }
  else {
    interval = setInterval(pool, POOL_MS)
    pool()
  }

  return {
    operationId,
    status,
    error,
    destroy,
  }
}
