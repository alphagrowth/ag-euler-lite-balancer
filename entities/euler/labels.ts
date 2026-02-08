export type EulerLabelEntity = {
  name: string
  logo: string
  description: string
  url: string
  addresses: Record<string, string>
  social: {
    twitter: string
    youtube: string
    discord: string
    telegram: string
    github: string
  }
}
export type EulerLabelProduct = {
  name: string
  description: string
  entity: string[] | string
  url: string
  vaults: string[]
  deprecatedVaults?: string[]
  deprecationReason?: string
  isGovernanceLimited?: boolean
  block?: string[]
  featured?: boolean
}
export type EulerLabelPoint = {
  name: string
  logo: string
  collateralVaults?: string[]
  isTurtleClub?: boolean
  skipValidation?: boolean
}

export type EulerLabelPointReward = {
  name: string
  logo: string
}

export const eulerLabelEntityEmpty = {
  name: '',
  logo: '',
  description: '',
  url: '',
  addresses: {},
  social: {
    twitter: '',
    youtube: '',
    discord: '',
    telegram: '',
    github: '',
  },
} as EulerLabelEntity
export const eulerLabelProductEmpty = {
  name: '',
  description: '',
  entity: [],
  url: '',
  vaults: [],
  deprecatedVaults: [],
  deprecationReason: '',
} as EulerLabelProduct

export const getEulerLabelEntityLogo = (fileName: string) => {
  const { EULER_LABELS_LOGO_URL } = useEulerConfig()
  return `${EULER_LABELS_LOGO_URL}/${fileName}`
}
