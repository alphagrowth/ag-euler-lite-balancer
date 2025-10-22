import type { Network } from '@tonappchain/sdk'
import config from '~/entities/config'

export const useAppConfig = () => {
  const { network } = useRuntimeConfig().public

  return config[network as Network]
}
