export const useDeployConfig = () => {
  const rc = useRuntimeConfig().public
  const envConfig = useEnvConfig()

  const isEnabled = (val: unknown) => {
    const s = String(val)
    return s !== 'false' && s !== '0'
  }
  const labelsBaseUrl = (rc.configLabelsBaseUrl || '').trim().replace(/\/+$/, '')

  return {
    // URLs (empty string = not configured, hide UI element)
    docsUrl: rc.configDocsUrl,
    tosUrl: rc.configTosUrl || 'https://www.euler.finance/terms',
    tosMdUrl: rc.configTosMdUrl,
    xUrl: rc.configXUrl,
    discordUrl: rc.configDiscordUrl,
    telegramUrl: rc.configTelegramUrl,
    githubUrl: rc.configGithubUrl,

    // Branding (from useEnvConfig, not runtimeConfig)
    appTitle: envConfig.appTitle,
    appDescription: envConfig.appDescription,
    logoUrl: envConfig.logoUrl,

    // Repos
    labelsRepo: rc.configLabelsRepo || 'euler-xyz/euler-labels',
    labelsRepoBranch: rc.configLabelsRepoBranch || 'master',
    oracleChecksRepo: rc.configOracleChecksRepo || 'euler-xyz/oracle-checks',
    labelsBaseUrl,
    oracleChecksBaseUrl: (rc.configOracleChecksBaseUrl || '').trim().replace(/\/+$/, ''),
    isCustomLabelsRepo: computed(() => {
      if (labelsBaseUrl) {
        return !labelsBaseUrl.includes('master')
      }
      const repo = rc.configLabelsRepo || 'euler-xyz/euler-labels'
      const branch = rc.configLabelsRepoBranch || 'master'
      return repo !== 'euler-xyz/euler-labels' || branch !== 'master'
    }),

    // Feature flags: all enabled by default, set env var to 'false' to disable
    enableTosSignature: !!rc.configTosMdUrl,
    enableEntityBranding: isEnabled(rc.configEnableEntityBranding),
    enableVaultType: isEnabled(rc.configEnableVaultType),
    enableEarnPage: isEnabled(rc.configEnableEarnPage),
    enableLendPage: isEnabled(rc.configEnableLendPage),
    enableExplorePage: isEnabled(rc.configEnableExplorePage),
    enablePoweredByEuler: isEnabled(rc.configEnablePoweredByEuler),
    enableAppTitle: isEnabled(rc.configEnableAppTitle),
    enableMerkl: isEnabled(rc.configEnableMerkl),
    enableIncentra: isEnabled(rc.configEnableIncentra),
    enableFuul: isEnabled(rc.configEnableFuul),

    // External token lists (defaults in server/api/token-list.get.ts)
    uniswapTokenListUrl: rc.configUniswapTokenListUrl || '',
    defillamaTokenListUrl: rc.configDefillamaTokenListUrl || '',

    // Chains (derived from env vars at runtime via useChainConfig)
    ...useChainConfig(),
  }
}
