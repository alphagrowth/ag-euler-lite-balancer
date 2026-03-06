export interface FuulPool {
  name: string
  token0_symbol: string
  token0_address: string
}

export interface FuulTrigger {
  type: string
  context: {
    chain_id: number
    token_address: string
  }
}

export interface FuulIncentive {
  conversion: string
  project: string
  protocol: string
  chain_id: number
  pool: FuulPool
  trigger: FuulTrigger
  apr: number
  tvl: number
  refreshed_at: string
}
